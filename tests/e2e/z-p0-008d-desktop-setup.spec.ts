import { test, expect, type Page } from "@playwright/test";
import { wipeAndRebindE2eServer } from "../helpers/e2e-restart-server";

const OWNER_SECRET =
  process.env.INSTALLATION_OWNER_SECRET ??
  "e2e-installation-owner-secret-with-enough-entropy-0123456789ab";
const MANAGER_PASS = "Unique-passphrase-ok!999";

async function ownerIssueInvite(page: Page): Promise<string> {
  await page.context().clearCookies();
  await page.goto("/owner");
  await expect(page.getByTestId("owner-secret-input")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("owner-secret-input").fill(OWNER_SECRET);
  await page.getByTestId("owner-secret-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("owner-console")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("owner-issue-invite").click();
  await expect(page.getByTestId("owner-invite-link")).toBeVisible();
  return page.getByTestId("owner-invite-link").inputValue();
}

test.describe("P0-008D desktop guided setup", () => {
  test.beforeEach(async ({ baseURL, context }) => {
    test.skip(
      !baseURL || test.info().project.name !== "chromium-008a-desktop",
      "Desktop geometry for P0-008D uses chromium-008a-desktop",
    );
    await context.clearCookies();
    await wipeAndRebindE2eServer(baseURL!);
  });

  test("P0-008D AT12 desktop: guide rail visible after household continue", async ({ page }) => {
    test.setTimeout(180_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("setup-display-name").fill("Desktop Parent");
    await page.getByTestId("setup-login-name").fill(`desk.${Date.now().toString(36)}`);
    await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("setup-account-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("setup-household-name").fill("Desktop Guide Home");
    await page.getByTestId("setup-timezone-confirm").check();
    await page.getByTestId("setup-household-form").locator("button[type=submit]").click();
    await page.getByTestId("setup-continue-guide").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".guided-setup-rail")).toBeVisible();
    await expect(page.getByTestId("guide-step-people")).toHaveClass(/is-current/);
  });
});
