import { test, expect, type Page } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";
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

  test("P0-008D AT10: ordinary UI setup → people → school → work → Settings return → backup path", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const displayName = "Journey Parent";
    const loginName = `mgrd10.${Date.now().toString(36)}`;
    await completeRequiredBasics(page, loginName, displayName, "Journey Household");
    await page.getByTestId("setup-continue-guide").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });

    await addGuidePerson(page, "Taylor", "adult");
    await addGuidePerson(page, "Morgan", "child");
    await page.getByTestId("guide-people-continue").click();
    await expect(page.getByTestId("guide-school")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("guide-school-not-now").click();

    await expect(page.getByTestId("guide-work")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("guide-work-kind").selectOption("responsibility");
    await page.getByTestId("guide-work-title").fill("Kitchen duty");
    await page.getByTestId("guide-assignment-mode").selectOption("weekly");
    await expect(page.getByTestId("guide-weekly-map")).toBeVisible();
    await page.getByTestId("guide-work-review").click();
    await expect(page.getByTestId("guide-work-preview")).toBeVisible({ timeout: 20_000 });
    const saveWork = page.getByTestId("guide-work-save");
    await saveWork.scrollIntoViewIfNeeded();
    await expect(saveWork).toBeEnabled();
    await saveWork.click({ force: true });
    await expect(page.getByTestId("guide-recap")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("guide-recap-work")).toContainText("Kitchen duty");

    await page.getByTestId("guide-edit-saved-work").click();
    await expect(page.getByTestId("guide-work")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("guide-work-title")).toHaveValue("Kitchen duty");
    await page.getByTestId("guide-work-title").fill("Kitchen nights");
    await page.getByTestId("guide-work-review").click();
    await expect(page.getByTestId("guide-work-preview")).toContainText("Kitchen nights", {
      timeout: 20_000,
    });
    const saveEdit = page.getByTestId("guide-work-save");
    await saveEdit.scrollIntoViewIfNeeded();
    await expect(saveEdit).toBeEnabled();
    await saveEdit.click({ force: true });
    await expect(page.getByTestId("guide-recap")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("guide-go-today").click();
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
