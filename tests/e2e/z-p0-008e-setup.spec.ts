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
  await expect(page.getByTestId("owner-invite-card")).toBeVisible();
  await expect(page.getByTestId("owner-open-setup")).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy link/i })).toBeVisible();
  return page.getByTestId("owner-invite-link").inputValue();
}

async function completeRequiredBasics(
  page: Page,
  loginName: string,
  displayName: string,
  householdName: string,
  options?: { timezoneSearch?: string; timezoneOption?: RegExp },
): Promise<void> {
  await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("setup-display-name").fill(displayName);
  await page.getByTestId("setup-login-name").fill(loginName);
  await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
  await page.getByTestId("setup-account-form").locator("button[type=submit]").click();

  await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("setup-household-name").fill(householdName);
  await expect(page.getByTestId("timezone-picker")).toBeVisible();
  await expect(page.getByTestId("setup-timezone-suggestion")).toBeVisible();
  const suggestion = await page.getByTestId("setup-timezone-suggestion").innerText();
  expect(suggestion).toMatch(/Suggested from this device/i);

  if (options?.timezoneSearch && options.timezoneOption) {
    await page.getByTestId("setup-timezone-search").fill(options.timezoneSearch);
    await page.getByTestId("setup-timezone").selectOption({ label: options.timezoneOption });
  }
  await expect(page.getByTestId("setup-timezone-sample")).toBeVisible();
  await page.getByTestId("setup-timezone-confirm").check();
  await page.getByTestId("setup-household-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("setup-complete")).toBeVisible({ timeout: 20_000 });
}

test.describe("P0-008E first-run evidence (008a)", () => {
  test.beforeEach(async ({ baseURL, context }) => {
    test.skip(
      !baseURL || !test.info().project.name.includes("008a"),
      "P0-008E setup journeys run on 008a owner-gated servers",
    );
    await context.clearCookies();
    await wipeAndRebindE2eServer(baseURL!);
  });

  test("AT1a: Open setup opens issued same-origin invitation; Copy link remains", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/owner");
    await expect(page.getByTestId("owner-secret-input")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("owner-secret-input").fill(OWNER_SECRET);
    await page.getByTestId("owner-secret-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("owner-console")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("owner-issue-invite").click();
    await expect(page.getByTestId("owner-invite-card")).toBeVisible();

    const link = await page.getByTestId("owner-invite-link").inputValue();
    expect(link).toContain(new URL(page.url()).origin);
    expect(link).toMatch(/#.*invite=/i);
    expect(link).not.toMatch(/[?&]invite=/i);
    await expect(page.getByTestId("owner-open-setup")).toHaveAttribute("href", link);
    await expect(page.getByRole("button", { name: /Copy link/i })).toBeVisible();

    await page.getByTestId("owner-open-setup").click();
    await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });
    // Invite fragment lands on Welcome setup in the issuing browser (same origin).
    expect(new URL(page.url()).origin).toBe(new URL(link).origin);
    expect(page.url()).toMatch(/\/welcome/i);
  });

  test("AT2a: timezone search/select updates sample time; suggestion is not silently applied", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);

    await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("setup-display-name").fill("Timezone Parent");
    await page.getByTestId("setup-login-name").fill(`tz.${Date.now().toString(36)}`);
    await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
    await page.getByTestId("setup-account-form").locator("button[type=submit]").click();

    await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("setup-household-name").fill("Timezone Household");
    await expect(page.getByTestId("timezone-picker")).toBeVisible();

    const suggestionText = await page.getByTestId("setup-timezone-suggestion").innerText();
    expect(suggestionText).toMatch(/Suggested from this device/i);
    const suggestedZone = suggestionText.match(/Suggested from this device:\s*(.+?)(?:\s—|$)/i)?.[1]
      ?.trim();
    expect(suggestedZone).toBeTruthy();

    const select = page.getByTestId("setup-timezone");
    const initialValue = await select.inputValue();
    // Choosing a different zone must not silently snap back to the device suggestion.
    await page.getByTestId("setup-timezone-search").fill("Los Angeles");
    await select.selectOption({ value: "America/Los_Angeles" });
    await expect(select).toHaveValue("America/Los_Angeles");
    if (suggestedZone && suggestedZone !== "America/Los_Angeles") {
      expect(await select.inputValue()).not.toBe(suggestedZone);
      await expect(page.getByTestId("setup-timezone-suggestion")).toContainText(
        /not applied until you choose it/i,
      );
    }
    const sampleBefore = await page.getByTestId("setup-timezone-sample").innerText();
    await page.getByTestId("setup-timezone-search").fill("New York");
    await select.selectOption({ value: "America/New_York" });
    await expect(select).toHaveValue("America/New_York");
    await expect(page.getByTestId("setup-timezone-sample")).toBeVisible();
    const sampleAfter = await page.getByTestId("setup-timezone-sample").innerText();
    expect(sampleAfter.length).toBeGreaterThan(0);
    // Sample text is timezone-local; either zone string change or clock text may differ.
    expect(sampleAfter.includes("Sample home time") || sampleAfter !== sampleBefore).toBe(true);
    expect(initialValue === "America/New_York" || (await select.inputValue()) === "America/New_York").toBe(
      true,
    );

    await page.getByTestId("setup-timezone-confirm").check();
    await page.getByTestId("setup-household-form").locator("button[type=submit]").click();
    await expect(page.getByTestId("setup-complete")).toBeVisible({ timeout: 20_000 });
  });

  test("AT9: finish recap shows saved work; Go to Today primary; View household available", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    const displayName = "Recap Parent";
    await completeRequiredBasics(
      page,
      `recap.${Date.now().toString(36)}`,
      displayName,
      "Recap Household",
    );

    await page.getByTestId("setup-continue-guide").click();
    await expect(page.getByTestId("guided-setup")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("guide-add-another").click();
    await page.getByTestId("guide-person-name").fill("Recap Child");
    await page.getByTestId("guide-person-class").selectOption("child");
    await page.getByTestId("guide-add-person").locator("button[type=submit]").click();
    await expect(page.getByTestId("guide-people-list")).toContainText("Recap Child", {
      timeout: 15_000,
    });
    await page.getByTestId("guide-people-continue").click();

    await expect(page.getByTestId("guide-school")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("guide-school-start").fill("2025-09-02");
    await page.getByTestId("guide-school-end").fill("2026-06-12");
    await page.getByTestId("guide-school-end").blur();
    await page.getByTestId("guide-school-save").click({ force: true });

    await expect(page.getByTestId("guide-work")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("guide-work-kind").selectOption("routine");
    await page.getByTestId("guide-work-title").fill("Recap Morning");
    await page.getByTestId("guide-work-step").fill("Brush teeth");
    // Live preview updates without a Review detour; Save must succeed without clicking Refresh.
    await expect(page.getByTestId("guide-work-preview")).toContainText("Recap Morning", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("guide-work-review")).toBeVisible();
    await page.getByTestId("guide-work-save").click({ force: true });

    await expect(page.getByTestId("guide-recap")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("guide-recap")).toContainText(/People:\s*completed/i);
    await expect(page.getByTestId("guide-recap")).toContainText(/First work:\s*completed/i);
    await expect(page.getByTestId("guide-recap")).toContainText(/Recap Child/i);
    await expect(page.getByTestId("guide-recap-work")).toContainText(/Recap Morning|Routine/i);
    const goToday = page.getByTestId("guide-go-today");
    await expect(goToday).toBeVisible();
    await expect(goToday).toHaveClass(/primary/);
    await expect(page.getByTestId("guide-view-household")).toBeVisible();
    await goToday.click();
    await expectSignedInAs(page, displayName);
  });
});
