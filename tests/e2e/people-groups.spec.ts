import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";

function requestOrigin(_request?: APIRequestContext): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
}

async function ensureManagerSession(request: APIRequestContext) {
  const origin = requestOrigin(request);
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

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  await page.goto("/");
  await expect(page.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
}

test.describe("P0-004A People & Groups", () => {
  test("phone UI covers people, access setup, and group edit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);

    await page.getByRole("button", { name: "People & Groups" }).click();
    await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible();

    await page.getByLabel("Display name").first().fill("Elizabeth");
    await page.getByRole("radio", { name: "Child" }).first().check();
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByText("Elizabeth added.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Elizabeth/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Elizabeth/ }).getByText("Not set up"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Elizabeth/ }).getByText("Child")).toBeVisible();

    await page.getByRole("radio", { name: /Guided member/i }).check();
    await page.getByRole("button", { name: "Prepare access setup" }).click();
    await expect(page.getByText(/Copy this setup material now/i)).toBeVisible();
    await expect(page.getByText("Setup ready").first()).toBeVisible();

    await page.getByRole("button", { name: "Cancel setup" }).click();
    await expect(page.getByText("Setup cancelled.")).toBeVisible();
    await expect(page.getByText("Not set up").first()).toBeVisible();

    await page.getByRole("button", { name: "Create group" }).click();
    await page.getByLabel("Group name").fill("Kids");
    await page.getByRole("checkbox", { name: "Elizabeth" }).check();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByText(/Saved group Kids/)).toBeVisible();

    await page.getByRole("button", { name: /Kids/ }).first().click();
    await page.getByLabel("Group name").fill("Reed kids");
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByText(/Saved group Reed kids/)).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "People & Groups" }).click();
    await expect(page.getByRole("button", { name: /Elizabeth/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reed kids/ })).toBeVisible();
  });

  test("open People & Groups converges after peer person create", async ({ browser }) => {
    const managerA = await browser.newContext();
    const managerB = await browser.newContext();
    const pageA = await managerA.newPage();
    const pageB = await managerB.newPage();
    await pageA.setViewportSize({ width: 390, height: 844 });
    await pageB.setViewportSize({ width: 390, height: 844 });

    await openAsManager(pageA);
    await openAsManager(pageB);
    await pageA.getByRole("button", { name: "People & Groups" }).click();
    await pageB.getByRole("button", { name: "People & Groups" }).click();

    const name = `Peer ${Date.now().toString(36)}`;
    await pageA.getByLabel("Display name").first().fill(name);
    await pageA.getByRole("radio", { name: "Child" }).first().check();
    await pageA.getByRole("button", { name: "Add person" }).click();
    await expect(pageA.getByText(`${name} added.`)).toBeVisible();
    await expect(pageB.getByRole("button", { name: new RegExp(name) })).toBeVisible({
      timeout: 15_000,
    });

    await managerA.close();
    await managerB.close();
  });
});
