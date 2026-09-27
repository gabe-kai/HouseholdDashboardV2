import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";

const PEOPLE = [
  "Morgan Reed",
  "Avery Reed",
  "Jordan Reed",
  "Casey Reed",
  "Taylor Reed",
  "Rowan Reed",
];

function requestOrigin(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
}

async function ensureManagerSession(request: APIRequestContext) {
  const origin = requestOrigin();
  const boot = await request.post("/api/v1/test/bootstrap-claim");
  if (boot.ok()) {
    const { token } = (await boot.json()) as { token: string };
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: origin },
      data: {
        claimToken: token,
        loginName: MANAGER_LOGIN,
        passphrase: PASSPHRASE,
        displayName: "Morgan Reed",
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  expect(boot.status()).toBe(409);
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: MANAGER_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function openManagerDisplays(page: Page) {
  await ensureManagerSession(page.request);
  await page.goto("/");
  await expectSignedInAs(page, "Morgan Reed");
  await page.getByRole("button", { name: "Household", exact: true }).click();
  await page
    .getByRole("navigation", { name: /Household/i })
    .getByRole("button", { name: /^Household displays/i })
    .click();
  await expect(page.getByRole("heading", { name: "Household displays" })).toBeVisible();
}

test.describe("P0-007C-2 manager-to-wall enrollment", () => {
  test("AT2: manager creates display, wall claims By person, revoke via UI", async ({
    page,
    browser,
  }) => {
    const label = `Dining ${Date.now().toString(36)}`;
    await openManagerDisplays(page);

    await page.getByTestId("display-label-input").fill(label);
    await page.getByRole("button", { name: "Add display" }).click();
    await expect(page.getByTestId("display-code-panel")).toBeVisible();
    const codeText = (await page.getByTestId("display-issued-code").innerText()).trim();
    expect(codeText.replace(/[\s-]/g, "").length).toBe(16);
    await expect(page.getByText("/display")).toBeVisible();

    // Separate signed-out browser context claims the code.
    const wall = await browser.newContext();
    const wallPage = await wall.newPage();
    await wallPage.goto("/display");
    await expect(wallPage.getByTestId("display-setup")).toBeVisible();
    await wallPage.getByTestId("display-claim-code").fill(codeText);
    await wallPage.getByRole("button", { name: "Connect display" }).click();
    await expect(wallPage.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await expect(wallPage.getByTestId("display-by-person")).toBeVisible();
    for (const name of PEOPLE) {
      const person = wallPage
        .getByTestId("display-by-person")
        .locator(".display-person-card")
        .filter({ hasText: name.split(" ")[0]! });
      await expect(person).toBeVisible({ timeout: 20_000 });
    }
    await expect(wallPage.getByText(/Read-only wall view/i)).toBeVisible();
    // No personal Today chrome
    await expect(wallPage.getByRole("button", { name: "Today", exact: true })).toHaveCount(0);

    // Manager sees active device and revokes.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Household displays" })).toBeVisible();
    await expect(page.getByText(label)).toBeVisible();
    await expect(page.getByText(/Active access/i)).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Revoke access" }).first().click();
    await expect(page.getByText(/Revoked/i).first()).toBeVisible({ timeout: 15_000 });

    await wallPage.reload();
    await expect(wallPage.getByTestId("display-setup")).toBeVisible({ timeout: 20_000 });
    await expect(wallPage.getByTestId("display-by-person")).toHaveCount(0);

    await wall.close();
  });

  test("AT2b: claim while signed in shows recovery guidance without damaging session", async ({
    page,
    browser,
  }) => {
    const label = `Conflict ${Date.now().toString(36)}`;
    await openManagerDisplays(page);
    await page.getByTestId("display-label-input").fill(label);
    await page.getByRole("button", { name: "Add display" }).click();
    const codeText = (await page.getByTestId("display-issued-code").innerText()).trim();

    // Same signed-in context tries /display claim path via API-backed form in a
    // second context that first logs in as manager.
    const conflictCtx = await browser.newContext();
    const conflictPage = await conflictCtx.newPage();
    await ensureManagerSession(conflictPage.request);
    await conflictPage.goto("/display");
    await expect(conflictPage.getByTestId("display-setup")).toBeVisible();
    await conflictPage.getByTestId("display-claim-code").fill(codeText);
    await conflictPage.getByRole("button", { name: "Connect display" }).click();
    await expect(conflictPage.getByText(/Sign out of your household account/i)).toBeVisible();

    // Human session still works on personal app.
    await conflictPage.goto("/today");
    await expectSignedInAs(conflictPage, "Morgan Reed");

    await conflictCtx.close();
  });

  test("AT2c: cancel and replace outstanding code via UI; old code fails claim", async ({
    page,
    browser,
  }) => {
    const label = `Codes ${Date.now().toString(36)}`;
    await openManagerDisplays(page);
    await page.getByTestId("display-label-input").fill(label);
    await page.getByRole("button", { name: "Add display" }).click();
    await expect(page.getByTestId("display-code-panel")).toBeVisible();
    const firstCode = (await page.getByTestId("display-issued-code").innerText()).trim();

    // Cancel outstanding setup via UI (shared e2e DB may have multiple displays).
    await page
      .locator(".display-manager-row")
      .filter({ hasText: label })
      .getByRole("button", { name: "Cancel setup" })
      .click();
    await expect(
      page.locator(".display-manager-row").filter({ hasText: label }).getByText(/Needs setup/i),
    ).toBeVisible();

    const wall = await browser.newContext();
    const wallPage = await wall.newPage();
    await wallPage.goto("/display");
    await wallPage.getByTestId("display-claim-code").fill(firstCode);
    await wallPage.getByRole("button", { name: "Connect display" }).click();
    await expect(wallPage.getByText(/Invalid or expired setup code/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(wallPage.getByTestId("display-overview")).toHaveCount(0);

    // Generate a new code and prove it works; then replace and prove old fails.
    await page
      .locator(".display-manager-row")
      .filter({ hasText: label })
      .getByRole("button", { name: /Generate new code|Replace code/i })
      .click();
    await expect(page.getByTestId("display-code-panel")).toBeVisible();
    const secondCode = (await page.getByTestId("display-issued-code").innerText()).trim();
    expect(secondCode).not.toBe(firstCode);

    await page
      .locator(".display-manager-row")
      .filter({ hasText: label })
      .getByRole("button", { name: "Replace code" })
      .click();
    await expect
      .poll(async () => (await page.getByTestId("display-issued-code").innerText()).trim(), {
        timeout: 15_000,
      })
      .not.toBe(secondCode);
    const thirdCode = (await page.getByTestId("display-issued-code").innerText()).trim();

    await wallPage.getByTestId("display-claim-code").fill(secondCode);
    await wallPage.getByRole("button", { name: "Connect display" }).click();
    await expect(wallPage.getByText(/Invalid or expired setup code/i)).toBeVisible({
      timeout: 15_000,
    });

    await wallPage.getByTestId("display-claim-code").fill(thirdCode);
    await wallPage.getByRole("button", { name: "Connect display" }).click();
    await expect(wallPage.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });

    await wall.close();
  });
});
