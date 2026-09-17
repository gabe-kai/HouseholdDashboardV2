import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { expectSignedInAs, fillFocusedRoutineCreate } from "../helpers/e2e-shell";

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

test.describe("P0-006A Vite development deep links", () => {
  test("Vite serves /plan/routines/:id after reload without falling through to 404", async ({
    page,
  }) => {
    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    const title = `Vite Deep ${Date.now().toString(36)}`;
    await fillFocusedRoutineCreate(page, {
      title,
      daypart: "evening",
      audienceName: "Morgan Reed",
      stepText: "Vite step",
    });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/plan\/routines\//);

    const detailPath = new URL(page.url()).pathname;
    expect(detailPath).toMatch(/^\/plan\/routines\/[^/]+$/);

    // Hard reload through the Vite dev server (not the production SPA fallback).
    await page.goto(detailPath);
    await expectSignedInAs(page, "Morgan Reed");
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe(detailPath);

    // Second navigation: cold entry to Plan list, then deep path again.
    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible();
    await page.goto(detailPath);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
  });
});
