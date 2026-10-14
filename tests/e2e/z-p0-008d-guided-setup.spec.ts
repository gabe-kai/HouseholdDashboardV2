import { test, expect, type Page } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";
import {
  restartPreservingE2eServer,
  wipeAndRebindE2eServer,
} from "../helpers/e2e-restart-server";

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

async function completeRequiredBasics(
  page: Page,
  loginName: string,
  displayName: string,
  householdName: string,
): Promise<void> {
  await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("setup-display-name").fill(displayName);
  await page.getByTestId("setup-login-name").fill(loginName);
  await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
  await page.getByTestId("setup-account-form").locator("button[type=submit]").click();

  await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("setup-household-name").fill(householdName);
  await page.getByTestId("setup-timezone-confirm").check();
  await page.getByTestId("setup-household-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("setup-complete")).toBeVisible({ timeout: 20_000 });
}

async function addGuidePerson(
  page: Page,
  name: string,
  classification: "adult" | "child",
): Promise<void> {
  await page.getByTestId("guide-add-another").click();
  await page.getByTestId("guide-person-name").fill(name);
  await page.getByTestId("guide-person-class").selectOption(classification);
  await page.getByTestId("guide-add-person").locator("button[type=submit]").click();
  await expect(page.getByTestId("guide-people-list")).toContainText(name, { timeout: 15_000 });
}

test.describe("P0-008D guided first household day", () => {
  test.beforeEach(async ({ baseURL, context }) => {
    test.skip(
      !baseURL || !test.info().project.name.includes("008a"),
      "P0-008D journeys run on 008a owner-gated servers",
    );
    await context.clearCookies();
    await wipeAndRebindE2eServer(baseURL!);
  });

  test("P0-008D AT2: phone journey people+school+routine+responsibility review → Today", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const displayName = "Guide Parent";
    await completeRequiredBasics(
      page,
      `mgrd.${Date.now().toString(36)}`,
      displayName,
      "Guide Day Household",
    );

    await page.getByTestId("setup-continue-guide").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("guide-manager-once")).toContainText(displayName);

    await addGuidePerson(page, "Jordan", "adult");
    await addGuidePerson(page, "Alex", "child");
    await addGuidePerson(page, "Sam", "child");
    await addGuidePerson(page, "Riley", "child");
    await addGuidePerson(page, "Casey", "child");

    await page.getByTestId("guide-people-continue").click();
    await expect(page.getByTestId("guide-school")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("guide-school-start").fill("2025-09-02");
    await page.getByTestId("guide-school-end").fill("2026-06-12");
    await page.getByTestId("guide-school-end").blur();
    const schoolSave = page.getByTestId("guide-school-save");
    await schoolSave.scrollIntoViewIfNeeded();
    await schoolSave.click({ force: true });

    await expect(page.getByTestId("guide-work")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("guide-work-kind").selectOption("both");
    await page.getByTestId("guide-work-title").fill("Morning checklist");
    await page.getByTestId("guide-work-daypart").selectOption("morning");
    await page.getByTestId("guide-work-step").fill("Get dressed");
    await page.getByTestId("guide-work-review").click();
    await expect(page.getByTestId("guide-work-preview")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("guide-work-title").fill("Family morning");
    await expect(page.getByTestId("guide-work-save")).toBeDisabled();
    await page.getByTestId("guide-work-review").click();
    await expect(page.getByTestId("guide-work-preview")).toContainText("Family morning", {
      timeout: 20_000,
    });
    const saveWork = page.getByTestId("guide-work-save");
    await saveWork.scrollIntoViewIfNeeded();
    await expect(saveWork).toBeEnabled();
    await saveWork.click({ force: true });

    await expect(page.getByTestId("guide-recap")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("guide-recap-work")).toBeVisible();
    await page.getByTestId("guide-go-today").click();
    await expectSignedInAs(page, displayName);
  });

  test("P0-008D AT3: account Back review; Settings Finish setup; save and finish later", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const displayName = "Return Parent";
    const loginName = `mgrd2.${Date.now().toString(36)}`;

    await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("setup-display-name").fill(displayName);
    await page.getByTestId("setup-login-name").fill(loginName);
    await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("setup-account-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("setup-household-back").click();
    await expect(page.getByTestId("setup-account-review")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("setup-account-form")).toHaveCount(0);
    await page.getByTestId("setup-account-review-continue").click();
    await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("setup-household-name").fill("Return Household");
    await page.getByTestId("setup-timezone-confirm").check();
    await page.getByTestId("setup-household-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("setup-complete")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, displayName);

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /Settings/ })
      .click();
    await expect(page.getByTestId("finish-setup-section")).toBeVisible();
    await expect(page.getByTestId("household-details-section")).toBeVisible();
    await page.getByTestId("settings-finish-setup").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("guide-save-finish-later").click();
    await expectSignedInAs(page, displayName);
  });

  test("P0-008D AT12: direct /household/setup reload stays on guide", async ({ page }) => {
    test.setTimeout(180_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const displayName = "Reload Parent";
    await completeRequiredBasics(
      page,
      `mgrd3.${Date.now().toString(36)}`,
      displayName,
      "Reload Household",
    );
    await page.getByTestId("setup-continue-guide").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/household\/setup/);
  });

  test("P0-008D AT10: invite/access/removal/backup/reset/Welcome restore UI journey", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(420_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const displayName = "Journey Parent";
    const loginName = `mgrd10.${Date.now().toString(36)}`;
    await completeRequiredBasics(page, loginName, displayName, "Journey Household");
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, displayName);

    // People: add unused + invitee; issue invitation; redeem; revoke; restore; remove both modes.
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /People & Groups/ })
      .click();
    await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible();

    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await page.getByLabel("Friendly name").fill("Unused Child");
    await page.getByRole("radio", { name: "Child" }).check();
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await expect(page.locator("#person-detail-heading")).toHaveText("Unused Child", {
      timeout: 15_000,
    });

    await page.getByRole("button", { name: /Back to People/i }).click();
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await page.getByLabel("Friendly name").fill("Invited Adult");
    await page.getByRole("radio", { name: "Adult" }).check();
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await expect(page.locator("#person-detail-heading")).toHaveText("Invited Adult", {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Manage sign-in" }).click();
    await page.getByRole("button", { name: "Set up sign-in" }).click();
    await expect(page.getByTestId("access-invite-link")).toBeVisible({ timeout: 15_000 });
    const accessLink = (await page.getByTestId("access-invite-link").textContent()) ?? "";
    expect(accessLink).toContain("access=");

    const inviteeLogin = `invd10.${Date.now().toString(36)}`;
    // Fresh browser context so the invitee is not already signed in as the manager.
    const inviteeContext = await page.context().browser()!.newContext();
    const inviteePage = await inviteeContext.newPage();
    try {
      await inviteePage.goto(accessLink.trim());
      await expect(inviteePage.getByTestId("access-claim-summary")).toBeVisible({ timeout: 20_000 });
      await inviteePage.getByLabel("Display name").fill("Invited Adult");
      await inviteePage.getByLabel("Login name").fill(inviteeLogin);
      await inviteePage.getByLabel("Passphrase").fill(MANAGER_PASS);
      await inviteePage.getByRole("button", { name: "Create account and sign in" }).click();
      await expectSignedInAs(inviteePage, "Invited Adult");
    } finally {
      await inviteeContext.close();
    }

    await page.reload();
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /People & Groups/ })
      .click();
    await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /Invited Adult/ }).first().click();
    await expect(page.getByTestId("people-sign-in-status")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Manage sign-in" }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Revoke sign-in" }).click();
    await expect(page.getByRole("button", { name: "Restore sign-in link" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Restore sign-in link" }).click();
    await expect(page.getByTestId("access-invite-link")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /Back to Invited Adult/i }).click();
    await expect(page.locator("#person-detail-heading")).toHaveText("Invited Adult");
    await page.getByRole("button", { name: "Remove from household" }).click();
    await expect(page.getByTestId("removal-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("removal-preview")).toContainText(/Depart|Delete/i);
    await page.getByLabel("Your password").fill(MANAGER_PASS);
    await page.getByRole("button", { name: /Confirm REMOVE/i }).click();
    await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: /Unused Child/ }).first().click();
    await page.getByRole("button", { name: "Remove from household" }).click();
    await expect(page.getByTestId("removal-preview")).toContainText("Delete unused person", {
      timeout: 15_000,
    });
    await page.getByLabel("Your password").fill(MANAGER_PASS);
    await page.getByRole("button", { name: /Confirm REMOVE/i }).click();
    await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible({
      timeout: 20_000,
    });

    // Backup → reset with backup off → protected Welcome restore → fresh sign-in.
    await page.goto("/household/settings");
    await expect(page.getByTestId("backups-section")).toBeVisible();
    await page.getByTestId("backup-label").fill("D journey backup");
    await page.getByTestId("backup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("backup-create").click();
    await expect(page.getByTestId("backup-list")).toContainText("Journey Household", {
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
    await expect(page.getByTestId("welcome-restore")).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/welcome");
    await expect(page.getByTestId("welcome-owner-secret")).toBeVisible();
    await restartPreservingE2eServer(baseURL!);

    const afterRestart = await page.context().newPage();
    try {
      await expect
        .poll(
          async () => {
            const res = await afterRestart.request.get("/api/v1/health");
            if (!res.ok()) return false;
            const nav = await afterRestart.goto("/welcome", { waitUntil: "domcontentloaded" });
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
      await expect(afterRestart.getByTestId("welcome-backup-list")).toContainText(
        "Journey Household",
        { timeout: 20_000 },
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
      await expectSignedInAs(afterRestart, displayName);
    } finally {
      await afterRestart.close();
    }
  });

  test("P0-008D AT9: dirty draft retained across soft guide refresh conflict", async ({ page }) => {
    test.setTimeout(180_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const displayName = "Dirty Parent";
    await completeRequiredBasics(
      page,
      `mgrd9.${Date.now().toString(36)}`,
      displayName,
      "Dirty Household",
    );
    await page.getByTestId("setup-continue-guide").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("guide-add-another").click();
    await page.getByTestId("guide-person-name").fill("Keep Draft");
    await expect(page.getByTestId("guide-person-name")).toHaveValue("Keep Draft");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(500);
    await expect(page.getByTestId("guide-person-name")).toHaveValue("Keep Draft");
  });
});
