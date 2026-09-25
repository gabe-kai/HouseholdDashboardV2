import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";

function requestOrigin(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
}

async function csrf(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { csrfToken: string }).csrfToken;
}

async function mutatingHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  return {
    "x-csrf-token": await csrf(request),
    Origin: requestOrigin(),
  };
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
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: MANAGER_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function enrollFreshDisplay(
  managerRequest: APIRequestContext,
  wall: Page,
  label: string,
): Promise<void> {
  await ensureManagerSession(managerRequest);
  const create = await managerRequest.post("/api/v1/displays", {
    headers: await mutatingHeaders(managerRequest),
    data: { mutationId: crypto.randomUUID(), label },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const code = ((await create.json()) as { enrollment: { code: string } }).enrollment.code;

  await wall.addInitScript(() => {
    window.__HD_DISPLAY_IDLE_MS = 2000;
  });
  await wall.goto("/display");
  await expect(wall.getByTestId("display-setup")).toBeVisible();
  await wall.getByTestId("display-claim-code").fill(code);
  await wall.getByRole("button", { name: "Connect display" }).click();
  await expect(wall.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
}

test.describe("P0-007C-2 wall inspection", () => {
  test("AT7: By person/By work switch, detail, idle return", async ({ page, browser }) => {
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollFreshDisplay(page.request, wall, `Inspect ${Date.now().toString(36)}`);

    await expect(wall.getByTestId("display-org-by-person")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await wall.getByTestId("display-org-by-work").click();
    await expect(wall.getByTestId("display-by-work")).toBeVisible();
    await wall.getByTestId("display-org-by-person").click();
    await expect(wall.getByTestId("display-by-person")).toBeVisible();

    const personButton = wall.getByTestId("display-by-person").locator("button").first();
    await personButton.click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();
    await expect(wall.getByRole("button", { name: "Back", exact: true })).toBeVisible();
    // No execution controls
    await expect(wall.getByRole("checkbox")).toHaveCount(0);
    await expect(wall.getByRole("button", { name: /complete|mark done/i })).toHaveCount(0);

    await wall.getByRole("button", { name: "Back", exact: true }).click();
    await expect(wall.getByTestId("display-overview")).toBeVisible();

    // Re-open and wait for idle return (2s via __HD_DISPLAY_IDLE_MS).
    await personButton.click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();
    await expect(wall.getByTestId("display-overview")).toBeVisible({ timeout: 8_000 });

    // By work detail path when work rows exist
    await wall.getByTestId("display-org-by-work").click();
    const workRow = wall.getByTestId("display-by-work").locator("button.display-work-row").first();
    if (await workRow.count()) {
      await workRow.click();
      await expect(wall.getByTestId("display-detail")).toBeVisible();
      await wall.getByRole("button", { name: "Back", exact: true }).click();
      await expect(wall.getByTestId("display-overview")).toBeVisible();
    }

    await wallCtx.close();
  });

  test("AT15: /household/displays is grant-gated; /display never mounts personal App", async ({
    page,
    browser,
  }) => {
    await ensureManagerSession(page.request);
    await page.goto("/household/displays");
    await expectSignedInAs(page, "Morgan Reed");
    await expect(page.getByTestId("household-displays")).toBeVisible();

    const wall = await browser.newContext();
    const wallPage = await wall.newPage();
    await wallPage.goto("/display");
    await expect(wallPage.getByTestId("display-shell")).toBeVisible();
    await expect(wallPage.getByTestId("display-setup")).toBeVisible();
    await expect(wallPage.getByRole("button", { name: "Plan", exact: true })).toHaveCount(0);
    await wall.close();
  });
});
