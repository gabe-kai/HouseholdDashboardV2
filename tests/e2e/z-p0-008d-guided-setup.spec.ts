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
    test.setTimeout(480_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const displayName = "Journey Parent";
    const loginName = `mgrd10.${Date.now().toString(36)}`;
    await completeRequiredBasics(page, loginName, displayName, "Journey Household");

    // Configure optional guide/work so the backup has restorable guide state.
    await page.getByTestId("setup-continue-guide").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await addGuidePerson(page, "Unused Child", "child");
    await addGuidePerson(page, "Invited Adult", "adult");
    await page.getByTestId("guide-people-continue").click();
    await expect(page.getByTestId("guide-school")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("guide-school-not-now").click();
    await expect(page.getByTestId("guide-work")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("guide-work-kind").selectOption("routine");
    await page.getByTestId("guide-work-title").fill("Journey Morning");
    await page.getByTestId("guide-work-daypart").selectOption("morning");
    await page.getByTestId("guide-work-step").fill("Stretch together");
    await page.getByTestId("guide-work-review").click();
    await expect(page.getByTestId("guide-work-preview")).toBeVisible({ timeout: 20_000 });
    const saveWork = page.getByTestId("guide-work-save");
    await saveWork.scrollIntoViewIfNeeded();
    await expect(saveWork).toBeEnabled();
    await saveWork.click({ force: true });
    await expect(page.getByTestId("guide-recap")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("guide-recap-work")).toContainText("Journey Morning");
    await page.getByTestId("guide-go-today").click();
    await expectSignedInAs(page, displayName);

    async function openPeople() {
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
    }

    await openPeople();
    await page.getByRole("button", { name: /Invited Adult/ }).first().click();
    await expect(page.locator("#person-detail-heading")).toHaveText("Invited Adult", {
      timeout: 15_000,
    });

    // Permissions change before access lifecycle.
    await page.getByRole("button", { name: "Edit permissions" }).click();
    await expect(page.getByTestId("person-permissions-section")).toBeVisible();
    await page
      .locator("label.choice-row")
      .filter({ hasText: /Manage household displays/i })
      .locator("input")
      .check();
    await page.getByRole("button", { name: "Preview & save" }).click();
    await page.getByRole("button", { name: "Confirm save" }).click();
    await expect(page.locator("#person-detail-heading")).toHaveText("Invited Adult", {
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Manage sign-in" }).click();
    await page.getByRole("button", { name: "Set up sign-in" }).click();
    await expect(page.getByTestId("access-invite-link")).toBeVisible({ timeout: 15_000 });
    const accessLink = (await page.getByTestId("access-invite-link").textContent()) ?? "";
    expect(accessLink).toContain("access=");

    const inviteeLogin = `invd10.${Date.now().toString(36)}`;
    const inviteeContext = await page.context().browser()!.newContext();
    const inviteePage = await inviteeContext.newPage();
    try {
      await inviteePage.goto(accessLink.trim());
      await expect(inviteePage.getByTestId("access-claim-summary")).toBeVisible({
        timeout: 20_000,
      });
      await inviteePage.getByLabel("Display name").fill("Invited Adult");
      await inviteePage.getByLabel("Login name").fill(inviteeLogin);
      await inviteePage.getByLabel("Passphrase").fill(MANAGER_PASS);
      await inviteePage.getByRole("button", { name: "Create account and sign in" }).click();
      await expectSignedInAs(inviteePage, "Invited Adult");

      // Record enrolled-person work so removal is Depart-with-history, not Delete.
      await inviteePage
        .getByRole("navigation", { name: "Primary" })
        .getByRole("button", { name: "Today", exact: true })
        .click();
      const stretch = inviteePage.getByRole("checkbox", { name: /Stretch together/i }).first();
      if (await stretch.isVisible({ timeout: 8_000 }).catch(() => false)) {
        await stretch.check();
      } else {
        const anyStep = inviteePage.locator('[data-testid^="step-"], input[type="checkbox"]').first();
        if (await anyStep.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await anyStep.click();
        }
      }
    } finally {
      await inviteeContext.close();
    }

    await page.reload();
    await openPeople();
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
    const restoreLink = (await page.getByTestId("access-invite-link").textContent()) ?? "";
    expect(restoreLink).toContain("access=");

    // Stale invitation and restore redeem each need a fresh document/module so
    // `#access=` is read once per load (StrictMode-safe hash consume).
    const staleContext = await page.context().browser()!.newContext();
    const stalePage = await staleContext.newPage();
    try {
      await stalePage.goto(accessLink.trim());
      await expect(stalePage.getByTestId("access-claim-summary")).toHaveCount(0, {
        timeout: 8_000,
      });
    } finally {
      await staleContext.close();
    }

    const restoreContext = await page.context().browser()!.newContext();
    const restorePage = await restoreContext.newPage();
    try {
      await restorePage.goto(restoreLink.trim());
      await expect(restorePage.getByTestId("access-claim-summary")).toBeVisible({
        timeout: 20_000,
      });
      await restorePage.getByRole("button", { name: "Restore sign-in" }).click();
      await expectSignedInAs(restorePage, "Invited Adult");
    } finally {
      await restoreContext.close();
    }

    await page.getByRole("button", { name: /Back to Invited Adult/i }).click();
    await expect(page.locator("#person-detail-heading")).toHaveText("Invited Adult");
    await page.getByRole("button", { name: "Remove from household" }).click();
    await expect(page.getByTestId("removal-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("removal-preview")).toContainText("Depart and keep history");
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

    // Backup (catalog lists the labeled household; reset-with-backup-off adds none) → Welcome restore.
    await page.goto("/household/settings");
    await expect(page.getByTestId("backups-section")).toBeVisible();
    await expect(page.getByTestId("backup-list")).not.toContainText("D journey backup");
    await page.getByTestId("backup-label").fill("D journey backup");
    await page.getByTestId("backup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("backup-create").click();
    await expect(page.getByTestId("backup-list")).toContainText("Journey Household", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("backup-list")).toContainText("D journey backup", {
      timeout: 15_000,
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
      // Reset-with-backup-off must not invent a second catalog entry for this household.
      const welcomeRows = afterRestart
        .getByTestId("welcome-backup-list")
        .locator("li")
        .filter({ hasText: "Journey Household" });
      await expect(welcomeRows).toHaveCount(1);
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

      // Restored household still carries guide work configured before backup.
      await afterRestart
        .getByRole("navigation", { name: "Primary" })
        .getByRole("button", { name: "Household", exact: true })
        .click();
      await afterRestart
        .getByRole("navigation", { name: "Household" })
        .getByRole("button", { name: /Settings/ })
        .click();
      await afterRestart.getByTestId("settings-finish-setup").click();
      await expect(afterRestart.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
      await expect(afterRestart.getByTestId("guide-recap-work")).toContainText("Journey Morning", {
        timeout: 15_000,
      });
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

  test("P0-008D AT9: two managers converge after actual socket loss on guide", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const displayName = "Socket Parent";
    const loginName = `mgrd9b.${Date.now().toString(36)}`;
    await completeRequiredBasics(page, loginName, displayName, "Socket Household");
    await page.getByTestId("setup-continue-guide").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    await addGuidePerson(page, "Socket Child", "child");
    await page.getByTestId("guide-people-continue").click();
    await expect(page.getByTestId("guide-school")).toBeVisible({ timeout: 15_000 });

    const peer = await browser.newContext();
    const peerPage = await peer.newPage();
    try {
      await peerPage.goto("/login");
      await peerPage.getByLabel("Login name").fill(loginName);
      await peerPage.getByLabel("Passphrase").fill(MANAGER_PASS);
      await peerPage.getByRole("button", { name: "Sign in" }).click();
      await expectSignedInAs(peerPage, displayName);
      await peerPage.goto("/household/setup");
      await expect(peerPage.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });

      await page.evaluate(() => {
        const sync = (window as unknown as { __hdSync?: { closeForTest?: () => void } }).__hdSync;
        sync?.closeForTest?.();
      });

      await peerPage.getByTestId("guide-school-not-now").click();
      await expect(peerPage.getByTestId("guide-work")).toBeVisible({ timeout: 30_000 });

      await expect
        .poll(
          async () => {
            await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
            return page.getByTestId("guide-work").isVisible().catch(() => false);
          },
          { timeout: 60_000, intervals: [1_000, 2_000] },
        )
        .toBe(true);
    } finally {
      await peer.close();
    }
  });

  test("P0-008D AT12: guide controls remain usable at phone width with keyboard focus", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 360, height: 800 });
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    await completeRequiredBasics(
      page,
      `mgrd12.${Date.now().toString(36)}`,
      "Geometry Parent",
      "Geometry Household",
    );
    await page.getByTestId("setup-continue-guide").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });
    const addAnother = page.getByTestId("guide-add-another");
    await expect(addAnother).toBeVisible();
    const box = await addAnother.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(36);
    await addAnother.focus();
    await expect(addAnother).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("guide-person-name")).toBeVisible();
    await page.getByTestId("guide-person-name").focus();
    await expect(page.getByTestId("guide-person-name")).toBeFocused();
  });
});
