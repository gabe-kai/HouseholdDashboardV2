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

async function completeSetup(
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
  await page.getByTestId("setup-go-today").click();
  await expectSignedInAs(page, displayName);
}

async function openPeopleGroups(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Household", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Household" })
    .getByRole("button", { name: /People & Groups/ })
    .click();
  await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible();
}

test.describe("P0-008C member access journeys", () => {
  test.beforeEach(async ({ baseURL, context }) => {
    test.skip(
      !baseURL || !test.info().project.name.includes("008a"),
      "P0-008C journeys run on 008a owner-gated servers",
    );
    await context.clearCookies();
    await wipeAndRebindE2eServer(baseURL!);
  });

  test("P0-008C AT2: manager adds a person, sees role + sign-in labels, issues a copyable invitation", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    await completeSetup(
      page,
      `mgrc.${Date.now().toString(36)}`,
      "Access Manager",
      "Access Household",
    );

    await openPeopleGroups(page);
    // Overview shows the manager's own Role + Sign-in labels.
    const managerRow = page.getByRole("button", { name: /Access Manager/ }).first();
    await expect(managerRow).toContainText("Manager");
    await expect(managerRow).toContainText("Active");

    // Add person: starts as a Member with no sign-in yet.
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add person" })).toBeVisible();
    await page.getByLabel("Name shown in the app").fill("Elizabeth");
    await page.getByRole("radio", { name: "Child" }).check();
    await page.getByRole("button", { name: "Add person", exact: true }).click();

    await expect(page.locator("#person-detail-heading")).toHaveText("Elizabeth", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("person-sign-in-section")).toBeVisible();
    await expect(page.getByTestId("people-role-label")).toHaveText("Member");
    await expect(page.getByTestId("people-sign-in-status")).toHaveText("Not set up");

    // Sign-in: issue an invitation; the one-time link is shown with Copy link.
    await page.getByRole("button", { name: "Manage sign-in" }).click();
    await expect(page.getByRole("heading", { name: "Manage sign-in" })).toBeVisible();
    await expect(page.getByTestId("people-sign-in-status")).toHaveText("Not set up");
    await page.getByRole("button", { name: "Set up sign-in" }).click();
    await expect(page.getByTestId("access-invite-link")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("access-invite-link")).toContainText("access=");
    await expect(page.getByTestId("access-copy-link")).toBeVisible();
    await expect(page.getByTestId("access-show-qr")).toBeVisible();
    await expect(page.getByTestId("people-sign-in-status")).toHaveText("Invitation ready", {
      timeout: 15_000,
    });

    // Back on the person detail the labels persist across a reload.
    await page.getByRole("button", { name: /Back to Elizabeth/i }).click();
    await expect(page.getByTestId("people-role-label")).toHaveText("Member");
    await expect(page.getByTestId("people-sign-in-status")).toHaveText("Invitation ready");
    await page.reload();
    await openPeopleGroups(page);
    await expect(page.getByRole("button", { name: /Elizabeth/ }).first()).toContainText(
      "Invitation ready",
    );
    await expect(page.getByRole("button", { name: /Elizabeth/ }).first()).toContainText("Member");
  });
});
