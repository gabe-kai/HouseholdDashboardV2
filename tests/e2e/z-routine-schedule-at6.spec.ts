import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { durableScreenshot } from "../helpers/durable-screenshot";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const R3_SCREENSHOT_DIR = path.resolve("reports/p0-005-r3-screenshots");

function requestOrigin(_request?: APIRequestContext): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d! + days, 12, 0, 0));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

async function ensureManagerSession(request: APIRequestContext) {
  const origin = requestOrigin(request);
  const boot = await request.post("/api/v1/test/bootstrap-claim");
  if (boot.ok()) {
    const { token } = (await boot.json()) as { token: string };
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: origin },
      data: {
        claimToken: token,
        loginName: MANAGER_LOGIN,
        passphrase: PASSPHRASE,
        displayName: "Morgan Reed",
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  expect(boot.status()).toBe(409);
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: MANAGER_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function householdToday(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { householdDate: string }).householdDate;
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  await page.goto("/");
  await expect(page.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
}

async function createNamedRoutine(page: Page, title: string, daypart = "evening") {
  await page.getByRole("button", { name: "Routines", exact: true }).click();
  await page.getByRole("button", { name: /Create routine/i }).click();
  await page.getByLabel("Name").fill(title);
  await page.getByLabel("Daypart").selectOption(daypart);
  await page.getByRole("button", { name: /Add people or groups|Edit people or groups/ }).click();
  await page
    .locator("fieldset")
    .filter({ hasText: "People" })
    .getByRole("checkbox", { name: /Morgan Reed/ })
    .check();
  await page.getByRole("button", { name: /Save who does this|Apply who does this/i }).click();
  await page.locator(".step-editor input").first().fill("Lifecycle step");
  await page.getByRole("button", { name: "Create routine", exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
}

async function scheduleUpcoming(page: Page, startDate: string, stepText: string) {
  await page.getByRole("button", { name: "Schedule for later", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Schedule for later" })).toBeVisible();
  await page.getByLabel("Starting").fill(startDate);
  await page.locator(".step-editor input").first().fill(stepText);
  await page.getByRole("button", { name: "Schedule change", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: new RegExp(`Change scheduled for ${startDate}`) }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(new RegExp(`Starting ${startDate}`))).toBeVisible();
}

async function backFromEditor(page: Page, options?: { expectDiscard?: boolean }) {
  if (options?.expectDiscard) {
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
  }
  await page.getByRole("button", { name: /Back to/i }).click();
}

test.describe("P0-005 r3 AT6 schedule move/collision/date boundary", () => {
  test("move upcoming, occupied-date collision, move to today, date rollover", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);

    const suffix = Date.now().toString(36);
    const title = `AT6 Schedule ${suffix}`;
    const today = await householdToday(page.request);
    const day2 = addDays(today, 2);
    const day4 = addDays(today, 4);
    const day3 = addDays(today, 3);

    await createNamedRoutine(page, title, "evening");
    await scheduleUpcoming(page, day2, "Pack day-two");
    await scheduleUpcoming(page, day4, "Pack day-four");

    // Move day4 earlier to day3 through Edit upcoming UI.
    await page
      .locator("li")
      .filter({ hasText: `Starting ${day4}` })
      .getByRole("button", { name: "Edit upcoming", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Edit upcoming change" })).toBeVisible();
    await page.getByLabel("Starting").fill(day3);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: new RegExp(`moved to ${day3}`, "i") }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(`Starting ${day3}`))).toBeVisible();
    await expect(page.getByText(new RegExp(`Starting ${day4}`))).toHaveCount(0);

    if (testInfo.project.name === "chromium") {
      fs.mkdirSync(R3_SCREENSHOT_DIR, { recursive: true });
      await durableScreenshot(page, path.join(R3_SCREENSHOT_DIR, "07-upcoming-moved.png"));
    }

    // Occupied-date collision: schedule-new onto day2; draft preserved with alternatives.
    await page.getByRole("button", { name: "Schedule for later", exact: true }).click();
    await page.getByLabel("Name").fill(`${title} collision draft`);
    await page.getByLabel("Starting").fill(day2);
    await page.locator(".step-editor input").first().fill("Should not replace day2");
    await page.getByRole("button", { name: "Schedule change", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/already starts on/i, {
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Choose another date" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit existing change" })).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue(`${title} collision draft`);

    if (testInfo.project.name === "chromium") {
      await durableScreenshot(page, path.join(R3_SCREENSHOT_DIR, "08-schedule-collision.png"));
    }

    // Keep draft and open the existing occupied entry (discard confirmation).
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Edit existing change" }).click();
    await expect(page.getByRole("heading", { name: "Edit upcoming change" })).toBeVisible();
    await expect(page.getByLabel("Starting")).toHaveValue(day2);
    await backFromEditor(page);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 10_000 });

    // Re-trigger collision to prove Choose another date keeps the editor and focuses Starting.
    await page.getByRole("button", { name: "Schedule for later", exact: true }).click();
    await page.getByLabel("Name").fill(`${title} collision draft 2`);
    await page.getByLabel("Starting").fill(day2);
    await page.locator(".step-editor input").first().fill("Still should not replace");
    await page.getByRole("button", { name: "Schedule change", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/already starts on/i, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Choose another date" }).click();
    await expect(page.locator("#routine-starting-date")).toBeFocused();
    await expect(page.getByLabel("Name")).toHaveValue(`${title} collision draft 2`);
    await backFromEditor(page, { expectDiscard: true });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 10_000 });

    // Move day2 to today (promote), respecting locks (Morgan unstarted → updates).
    await page
      .locator("li")
      .filter({ hasText: `Starting ${day2}` })
      .getByRole("button", { name: "Edit upcoming", exact: true })
      .click();
    await page.getByLabel("Starting").fill(today);
    await page.locator(".step-editor input").first().fill("Promoted today step");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /Moved to today/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(new RegExp(`Starting ${day2}`))).toHaveCount(0);
    await expect(page.getByText("Promoted today step")).toBeVisible();

    // Date-boundary: open editor, then session returns a rolled household date.
    await page.getByRole("button", { name: "Edit routine", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit routine" })).toBeVisible();
    await page.getByLabel("Name").fill(`${title} rollover draft`);
    const rolled = addDays(today, 1);
    await page.route("**/api/v1/auth/session", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: JSON.stringify({ ...body, householdDate: rolled }),
      });
    });
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/household date changed/i, {
      timeout: 15_000,
    });
    await expect(page.getByLabel("Name")).toHaveValue(`${title} rollover draft`);
    await page.unroute("**/api/v1/auth/session");

    if (testInfo.project.name === "chromium") {
      await durableScreenshot(page, path.join(R3_SCREENSHOT_DIR, "09-date-boundary.png"));
    }
  });
});
