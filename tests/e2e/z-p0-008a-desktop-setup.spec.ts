import { test, expect } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";
import { wipeAndRebindE2eServer } from "../helpers/e2e-restart-server";

const OWNER_SECRET =
  process.env.INSTALLATION_OWNER_SECRET ??
  "e2e-installation-owner-secret-with-enough-entropy-0123456789ab";
const MANAGER_PASS = "Unique-passphrase-ok!999";

/**
 * Desktop Account → Household only (AT4). Phone journeys live in
 * z-p0-008a-setup-reset.spec.ts so Chromium-008a-desktop does not re-run the
 * full reset matrix against the shared 008a server.
 */
test.describe("P0-008A desktop required basics", () => {
  test.beforeEach(async ({ baseURL }) => {
    test.skip(!baseURL, "baseURL required");
    await wipeAndRebindE2eServer(baseURL);
  });

  test("P0-008A desktop: Account → Household → Today", async ({ page }) => {
    await page.goto("/owner");
    await page.getByTestId("owner-secret-input").fill(OWNER_SECRET);
    await page.getByTestId("owner-secret-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("owner-console")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("owner-issue-invite").click();
    const inviteLink = await page.getByTestId("owner-invite-link").inputValue();

    await page.goto(inviteLink);
    await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });
    const loginName = `desk.${Date.now().toString(36)}`;
    await page.getByTestId("setup-display-name").fill("Desktop Manager");
    await page.getByTestId("setup-login-name").fill(loginName);
    await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("setup-account-form").locator("button[type=submit]").click();

    await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("setup-household-name").fill("Desktop Household");
    await page.getByTestId("setup-timezone-confirm").check();
    await page.getByTestId("setup-household-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("setup-complete")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("setup-go-today").click();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expectSignedInAs(page, "Desktop Manager");
  });
});
