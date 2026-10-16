import { test, expect } from "@playwright/test";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";

function requestOrigin(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
}

async function ensureManagerSession(request: import("@playwright/test").APIRequestContext) {
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

test.describe("P0-008D Vite guide deep links", () => {
  test("P0-008D Vite: /household/setup loads guided setup for manager", async ({ page }) => {
    await ensureManagerSession(page.request);
    await page.goto("/household/setup");
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/household\/setup/);
  });
});
