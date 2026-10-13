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

test.describe("P0-008D guided first household day", () => {
  test.beforeEach(async ({ baseURL, context }) => {
    test.skip(
      !baseURL || !test.info().project.name.includes("008a"),
      "P0-008D journeys run on 008a owner-gated servers",
    );
    await context.clearCookies();
    await wipeAndRebindE2eServer(baseURL!);
  });

  test("P0-008D AT2: phone journey through guide people → school skip → work skip → Today", async ({
    page,
  }) => {
    test.setTimeout(180_000);
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

    await page.getByTestId("guide-add-another").click();
    await page.getByTestId("guide-person-name").fill("Alex");
    await page.getByTestId("guide-person-class").selectOption("child");
    await page.getByTestId("guide-add-person").locator("button[type=submit]").click();
    await expect(page.getByTestId("guide-people-list")).toContainText("Alex", { timeout: 15_000 });

    await page.getByTestId("guide-people-continue").click();
    await expect(page.getByTestId("guide-school")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("guide-school-not-now").click();

    await expect(page.getByTestId("guide-work")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("guide-work-finish-for-now").click();

    await expect(page.getByTestId("guide-recap")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("guide-go-today").click();
    await expectSignedInAs(page, displayName);
  });

  test("P0-008D AT3: account Back shows review; Settings Finish setup reopens guide", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const displayName = "Return Parent";
    await completeRequiredBasics(
      page,
      `mgrd2.${Date.now().toString(36)}`,
      displayName,
      "Return Household",
    );

    // From done, go Today then Settings → Finish setup
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
});
