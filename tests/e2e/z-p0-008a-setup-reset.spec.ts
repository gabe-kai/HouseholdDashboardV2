import { test, expect } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

const OWNER_SECRET =
  process.env.INSTALLATION_OWNER_SECRET ??
  "e2e-installation-owner-secret-with-enough-entropy-0123456789ab";
const MANAGER_PASS = "Unique-passphrase-ok!999";

test.describe("P0-008A protected setup and reset", () => {
  test("P0-008A phone: owner invite, welcome setup, today, reset once", async ({
    page,
  }) => {
    await page.goto("/owner");
    await page.getByTestId("owner-secret-input").fill(OWNER_SECRET);
    await page.getByTestId("owner-secret-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("owner-console")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("owner-issue-invite").click();
    await expect(page.getByTestId("owner-invite-link")).toBeVisible();
    const inviteLink = await page.getByTestId("owner-invite-link").inputValue();

    await page.goto(inviteLink);
    await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });

    const loginName = `mgr.${Date.now().toString(36)}`;
    await page.getByTestId("setup-display-name").fill("Jordan Manager");
    await page.getByTestId("setup-login-name").fill(loginName);
    await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("setup-account-form").locator("button[type=submit]").click();

    await expect(page.getByTestId("setup-household-form")).toBeVisible();
    await page.getByTestId("setup-household-name").fill("E2E Household");
    await page.getByTestId("setup-timezone-confirm").check();
    await page.getByTestId("setup-household-form").locator("button[type=submit]").click();

    await expect(page.getByTestId("setup-complete")).toBeVisible();
    await page.getByTestId("setup-go-today").click();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expectSignedInAs(page, "Jordan Manager");

    await page.goto("/household/settings");
    await expect(page.getByTestId("reset-household-section")).toBeVisible();
    await page.getByRole("button", { name: /Reset household/i }).click();
    await expect(page.getByTestId("reset-household-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByTestId("reset-confirm-text").fill("RESET");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByTestId("reset-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("reset-submit").click();

    await expect(page.getByTestId("protected-welcome")).toBeVisible({ timeout: 30_000 });
    const meta = await page.request.get("/api/v1/meta");
    expect(meta.ok()).toBeTruthy();
    const metaBody = (await meta.json()) as { setupRequired: boolean; installationEpoch: number };
    expect(metaBody.setupRequired).toBe(true);
    expect(metaBody.installationEpoch).toBeGreaterThan(1);

    await page.goto("/owner");
    await page.getByTestId("owner-issue-invite").click();
    const secondLink = await page.getByTestId("owner-invite-link").inputValue();
    await page.goto(secondLink);
    const loginName2 = `mgr2.${Date.now().toString(36)}`;
    await page.getByTestId("setup-display-name").fill("Jordan Manager");
    await page.getByTestId("setup-login-name").fill(loginName2);
    await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("setup-account-form").locator("button[type=submit]").click();
    await page.getByTestId("setup-household-name").fill("E2E Household 2");
    await page.getByTestId("setup-timezone-confirm").check();
    await page.getByTestId("setup-household-form").locator("button[type=submit]").click();
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, "Jordan Manager");
  });
});
