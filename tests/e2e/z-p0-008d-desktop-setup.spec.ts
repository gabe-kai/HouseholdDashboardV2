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
    await expect(page.getByTestId("guide-rail")).toBeVisible();
    await expect(page.getByTestId("guide-step-people")).toHaveClass(/is-current/);
    await page.getByTestId("guide-rail-school").click();
    await expect(page.getByTestId("guide-school")).toBeVisible();
    await page.getByTestId("guide-rail-people").click();
    await expect(page.getByTestId("guide-step-people")).toBeVisible();
  });

  test("P0-008D AT12: guide form readable at tablet, desktop, and 200% text", async ({ page }) => {
    test.setTimeout(240_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("setup-display-name").fill("Layout Parent");
    await page.getByTestId("setup-login-name").fill(`layout.${Date.now().toString(36)}`);
    await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("setup-account-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("setup-household-name").fill("Layout Guide Home");
    await page.getByTestId("setup-timezone-confirm").check();
    await page.getByTestId("setup-household-form").locator("button[type=submit]").click();
    await page.getByTestId("setup-continue-guide").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("guide-people-continue").click();
    await page.getByTestId("guide-school-not-now").click();
    await expect(page.getByTestId("guide-work")).toBeVisible({ timeout: 30_000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("guide-work-kind").selectOption("responsibility");
    await page.getByTestId("guide-work-title").fill("Layout responsibility with a longer title");
    await page.getByTestId("guide-work-step").fill("Wipe the table");
    await page.getByTestId("guide-add-step").click();
    await expect(page.getByTestId("guide-assignment-mode")).toBeVisible();
    await expect(page.getByTestId("guide-scheduled-additions")).toBeVisible();
    await page.getByTestId("guide-work-review").click();
    await expect(page.getByTestId("guide-work-preview")).toBeVisible({ timeout: 20_000 });

    const shotDir = "reports/_local-screenshots/p0-008d-r2";
    const viewports = [
      { width: 768, height: 1024, name: "tablet-768" },
      { width: 1280, height: 800, name: "desktop-1280" },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const overflow = await page.locator(".guided-setup").evaluate((node) => {
        const el = node as HTMLElement;
        return el.scrollWidth <= el.clientWidth + 2;
      });
      expect(overflow).toBe(true);
      await expect(page.getByTestId("guide-work-review")).toBeVisible();
      await page.screenshot({
        path: `${shotDir}/${viewport.name}-work-form.png`,
        fullPage: true,
      });
    }
    await page.evaluate(() => {
      document.body.style.zoom = "2";
    });
    const review = page.getByTestId("guide-work-review");
    await review.scrollIntoViewIfNeeded();
    await expect(review).toBeVisible();
    const reviewBox = await review.boundingBox();
    expect(reviewBox).toBeTruthy();
    expect(reviewBox!.width).toBeGreaterThan(40);
    expect(reviewBox!.height).toBeGreaterThan(20);
    const focused = page.getByTestId("guide-work-title");
    await focused.focus();
    await expect(focused).toBeFocused();
    await page.keyboard.press("Tab");
    await page.screenshot({ path: `${shotDir}/desktop-200-zoom-work-form.png`, fullPage: true });
  });
});

