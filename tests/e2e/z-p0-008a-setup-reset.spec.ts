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

async function resetHousehold(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/household/settings");
  await expect(page.getByTestId("reset-household-section")).toBeVisible();
  await page.getByRole("button", { name: /Reset household/i }).click();
  await expect(page.getByTestId("reset-household-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("reset-confirm-text").fill("RESET");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("reset-passphrase").fill(MANAGER_PASS);
  await Promise.all([
    page.waitForURL(/\/welcome/, { timeout: 60_000 }),
    page.getByTestId("reset-submit").click(),
  ]);
  await expect(page.getByTestId("protected-welcome")).toBeVisible({ timeout: 30_000 });
}

test.describe("P0-008A protected setup and reset", () => {
  test.beforeEach(async ({ baseURL, context }) => {
    test.skip(!baseURL, "baseURL required");
    await context.clearCookies();
    await wipeAndRebindE2eServer(baseURL);
  });

  test("P0-008A phone: owner invite, welcome setup, today, reset once", async ({
    page,
  }) => {
    const inviteLink = await ownerIssueInvite(page);

    await page.goto(inviteLink);
    const loginName = `mgr.${Date.now().toString(36)}`;
    await completeAccountForm(page, loginName, "Jordan Manager");
    await completeHouseholdForm(page, "E2E Household");
    await page.getByTestId("setup-go-today").click();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expectSignedInAs(page, "Jordan Manager");

    await resetHousehold(page);
    const meta = await page.request.get("/api/v1/meta");
    expect(meta.ok()).toBeTruthy();
    const metaBody = (await meta.json()) as { setupRequired: boolean; installationEpoch: number };
    expect(metaBody.setupRequired).toBe(true);
    expect(metaBody.installationEpoch).toBeGreaterThan(1);

    const secondLink = await ownerIssueInvite(page);
    await page.goto(secondLink);
    const loginName2 = `mgr2.${Date.now().toString(36)}`;
    await completeAccountForm(page, loginName2, "Jordan Manager");
    await completeHouseholdForm(page, "E2E Household 2");
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, "Jordan Manager");
  });

  test("AT5 interrupted setup: restart after account save, resume via login, finish household", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    test.skip(!baseURL, "baseURL required for restart flag");
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const loginName = `resume.${Date.now().toString(36)}`;
    await completeAccountForm(page, loginName, "Resume Manager");
    await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 20_000 });

    await restartPreservingE2eServer(baseURL);

    // Resume on another browser context (other device) via normal login.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto("/today");
    await expect(otherPage.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 20_000,
    });
    await otherPage.getByLabel("Login name").fill(loginName);
    await otherPage.getByLabel("Passphrase").fill(MANAGER_PASS);
    await otherPage.getByRole("button", { name: "Sign in" }).click();
    await completeHouseholdForm(otherPage, "Resumed Household");
    await otherPage.getByTestId("setup-go-today").click();
    await expectSignedInAs(otherPage, "Resume Manager");
    await other.close();
  });

  test("AT7 two resets with differently named second household", async ({ page }) => {
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const login1 = `two1.${Date.now().toString(36)}`;
    await completeAccountForm(page, login1, "Two Reset Manager");
    await completeHouseholdForm(page, "First Reset Household");
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, "Two Reset Manager");

    await resetHousehold(page);
    const meta1 = await page.request.get("/api/v1/meta");
    const epoch1 = ((await meta1.json()) as { installationEpoch: number }).installationEpoch;

    const invite2 = await ownerIssueInvite(page);
    await page.goto(invite2);
    const login2 = `two2.${Date.now().toString(36)}`;
    await completeAccountForm(page, login2, "Two Reset Manager");
    await completeHouseholdForm(page, "Second Reset Household");
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, "Two Reset Manager");

    await resetHousehold(page);
    const meta2 = await page.request.get("/api/v1/meta");
    const body2 = (await meta2.json()) as {
      setupRequired: boolean;
      installationEpoch: number;
    };
    expect(body2.setupRequired).toBe(true);
    expect(body2.installationEpoch).toBeGreaterThan(epoch1);
  });

  test("AT8 optional: reload welcome recovers protected setup after reset", async ({
    page,
  }) => {
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const loginName = `cont.${Date.now().toString(36)}`;
    await completeAccountForm(page, loginName, "Continuation Manager");
    await completeHouseholdForm(page, "Continuation Household");
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, "Continuation Manager");

    await resetHousehold(page);
    await page.goto("/welcome");
    await expect(page.getByTestId("protected-welcome")).toBeVisible({ timeout: 20_000 });
    const meta = await page.request.get("/api/v1/meta");
    expect(((await meta.json()) as { setupRequired: boolean }).setupRequired).toBe(true);
  });
});
