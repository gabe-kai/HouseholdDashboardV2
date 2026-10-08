import { test, expect } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";
import {
  restartPreservingE2eServer,
  wipeAndRebindE2eServer,
} from "../helpers/e2e-restart-server";

const OWNER_SECRET =
  process.env.INSTALLATION_OWNER_SECRET ??
  "e2e-installation-owner-secret-with-enough-entropy-0123456789ab";
const MANAGER_PASS = "Unique-passphrase-ok!999";

async function ownerIssueInvite(page: import("@playwright/test").Page): Promise<string> {
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

async function completeAccountForm(
  page: import("@playwright/test").Page,
  loginName: string,
  displayName: string,
): Promise<void> {
  await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("setup-display-name").fill(displayName);
  await page.getByTestId("setup-login-name").fill(loginName);
  await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
  await page.getByTestId("setup-account-form").locator("button[type=submit]").click();
}

async function completeHouseholdForm(
  page: import("@playwright/test").Page,
  householdName: string,
): Promise<void> {
  await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("setup-household-name").fill(householdName);
  await page.getByTestId("setup-timezone-confirm").check();
  await page.getByTestId("setup-household-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("setup-complete")).toBeVisible({ timeout: 20_000 });
}

test.describe("P0-008B backups and restore", () => {
  test.beforeEach(async ({ baseURL, context }) => {
    test.skip(
      !baseURL ||
        (!test.info().project.name.includes("008a") &&
          !test.info().project.name.includes("008b")),
      "P0-008B journeys run on 008a/008b owner-gated servers",
    );
    await context.clearCookies();
    await wipeAndRebindE2eServer(baseURL!);
  });

  test("AT3: backup, reset without new backup, Welcome owner restore, sign in", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const loginName = `mgrb.${Date.now().toString(36)}`;
    await completeAccountForm(page, loginName, "Backup Manager");
    await completeHouseholdForm(page, "Backup Household");
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, "Backup Manager");

    await page.goto("/household/settings");
    await expect(page.getByTestId("backups-section")).toBeVisible();
    await page.getByTestId("backup-label").fill("School year start");
    await page.getByTestId("backup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("backup-create").click();
    await expect(page.getByTestId("backup-list")).toContainText("Backup Household", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("backup-list")).toContainText("School year start");

    await page.getByRole("button", { name: /Reset household/i }).click();
    await expect(page.getByTestId("reset-household-dialog")).toBeVisible();
    await expect(page.getByTestId("reset-save-backup")).not.toBeChecked();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByTestId("reset-confirm-text").fill("RESET");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByTestId("reset-passphrase").fill(MANAGER_PASS);
    await Promise.all([
      page.waitForURL(/\/welcome/, { timeout: 60_000 }),
      page.getByTestId("reset-submit").click(),
    ]);
    await expect(page.getByTestId("protected-welcome")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("welcome-restore")).toBeVisible();

    // Without an owner cookie, catalog rows must not appear on public Welcome.
    await page.context().clearCookies();
    await page.goto("/welcome");
    await expect(page.getByTestId("welcome-restore")).toBeVisible();
    await expect(page.getByTestId("welcome-backup-list")).toHaveCount(0);
    await expect(page.getByTestId("welcome-owner-secret")).toBeVisible();

    await restartPreservingE2eServer(baseURL!);

    // Soft-rebind can leave WebKit on a half-dead document ("Restoring your session…").
    // Continue on a fresh page after the server generation advances.
    await page.context().clearCookies();
    const afterRestart = await page.context().newPage();
    try {
      await expect
        .poll(
          async () => {
            const res = await afterRestart.request.get("/api/v1/health");
            if (!res.ok()) return false;
            const nav = await afterRestart.goto("/welcome", {
              waitUntil: "domcontentloaded",
            });
            if (nav && nav.status() >= 500) return false;
            try {
              await afterRestart
                .getByTestId("welcome-owner-secret")
                .waitFor({ state: "visible", timeout: 8_000 });
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 120_000, intervals: [1_000, 2_000] },
        )
        .toBe(true);
      await afterRestart.getByTestId("welcome-owner-secret").fill(OWNER_SECRET);
      await afterRestart.getByTestId("welcome-owner-unlock").click();
      await expect(afterRestart.getByTestId("welcome-backup-list")).toBeVisible({
        timeout: 20_000,
      });
      await expect(afterRestart.getByTestId("welcome-backup-list")).toContainText(
        "Backup Household",
      );
      await afterRestart.getByRole("button", { name: /Restore/i }).first().click();
      await expect(afterRestart.getByTestId("welcome-restore-confirm")).toBeVisible();
      await afterRestart.getByTestId("welcome-restore-submit").click();
      await expect(afterRestart.getByTestId("welcome-restore-done")).toBeVisible({
        timeout: 60_000,
      });

      await afterRestart
        .getByTestId("welcome-restore-done")
        .getByRole("link", { name: "Sign in" })
        .click();
      await afterRestart.getByLabel("Login name").fill(loginName);
      await afterRestart.getByLabel("Passphrase").fill(MANAGER_PASS);
      await afterRestart.getByRole("button", { name: "Sign in" }).click();
      await expectSignedInAs(afterRestart, "Backup Manager");
    } finally {
      await afterRestart.close();
    }
  });

  test("AT4: Settings restore replaces a different current household", async ({ page }) => {
    test.setTimeout(180_000);
    const originalLogin = `orig.${Date.now().toString(36)}`;
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    await completeAccountForm(page, originalLogin, "Original Manager");
    await completeHouseholdForm(page, "Original Household");
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, "Original Manager");

    await page.goto("/household/settings");
    await expect(page.getByTestId("backups-section")).toBeVisible();
    await page.getByTestId("backup-label").fill("Keep me");
    await page.getByTestId("backup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("backup-create").click();
    await expect(page.getByTestId("backup-list")).toContainText("Original Household", {
      timeout: 30_000,
    });

    await page.getByRole("button", { name: /Reset household/i }).click();
    await expect(page.getByTestId("reset-household-dialog")).toBeVisible();
    await expect(page.getByTestId("reset-save-backup")).not.toBeChecked();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByTestId("reset-confirm-text").fill("RESET");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByTestId("reset-passphrase").fill(MANAGER_PASS);
    await Promise.all([
      page.waitForURL(/\/welcome/, { timeout: 60_000 }),
      page.getByTestId("reset-submit").click(),
    ]);
    await expect(page.getByTestId("protected-welcome")).toBeVisible({ timeout: 30_000 });

    const replacementLogin = `repl.${Date.now().toString(36)}`;
    const nextInvite = await ownerIssueInvite(page);
    await page.goto(nextInvite);
    await completeAccountForm(page, replacementLogin, "Replacement Manager");
    await completeHouseholdForm(page, "Replacement Household");
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, "Replacement Manager");

    await page.goto("/household/settings");
    await expect(page.getByTestId("backup-list")).toContainText("Original Household");
    await page.getByRole("button", { name: /^Restore/i }).first().click();
    await expect(page.getByTestId("backup-restore-dialog")).toBeVisible();
    await expect(page.getByTestId("backup-restore-dialog")).toContainText("Replacement Household");
    await expect(page.getByTestId("backup-restore-dialog")).toContainText("Original Household");
    await expect(page.getByTestId("restore-save-backup")).not.toBeChecked();
    await page.getByTestId("restore-passphrase").fill(MANAGER_PASS);
    // Phone bottom nav can intercept pointer events on the dialog submit control.
    await page.locator('[data-testid="backup-restore-dialog"] form').evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });

    await expect(page.getByLabel("Login name")).toBeVisible({ timeout: 90_000 });
    await page.getByLabel("Login name").fill(originalLogin);
    await page.getByLabel("Passphrase").fill(MANAGER_PASS);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expectSignedInAs(page, "Original Manager");
    await page.goto("/household/settings");
    await expect(page.getByTestId("backup-list")).toContainText("Original Household");
    await expect(page.getByTestId("backup-list")).not.toContainText("Replacement Household");
  });
});
