import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { expectSignedInAs, fillFocusedResponsibilityCreate } from "../helpers/e2e-shell";

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
  await expectSignedInAs(page, "Morgan Reed");
}

test.describe("P0-007A Vite development deep links", () => {
  test("Vite serves /plan/responsibilities/:id after reload", async ({ page }) => {
    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    const title = `Vite Resp ${Date.now().toString(36)}`;
    await fillFocusedResponsibilityCreate(page, {
      title,
      weekdaysPreset: "every",
      ownerName: "Morgan Reed",
      stepTexts: ["Vite feed"],
    });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/plan\/responsibilities\//);

    const detailPath = new URL(page.url()).pathname;
    expect(detailPath).toMatch(/^\/plan\/responsibilities\/[^/]+$/);

    await page.goto(detailPath);
    await expectSignedInAs(page, "Morgan Reed");
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe(detailPath);

    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
    await page.goto(detailPath);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
  });
});
