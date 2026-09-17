import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  expectSignedInAs,
  fillFocusedRoutineCreate,
  openRoutineSection,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const SCREENSHOT_DIR = path.resolve("reports/p0-006b-r1-screenshots");

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

function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const day = utc.getUTCDay();
  return day === 0 ? 7 : day;
}

/** Next household date with the given ISO weekday (1=Mon…7=Sun), strictly after `from`. */
function nextWeekdayAfter(from: string, weekday: number): string {
  let candidate = addDays(from, 1);
  while (isoWeekday(candidate) !== weekday) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
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
  await expectSignedInAs(page, "Morgan Reed");
}

test.describe("P0-006B contextual routine applicability", () => {
  test("school calendar, school-day lunchbox, dated preview, exception, bedtime", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);
    const today = await householdToday(page.request);
    const yearStart = addDays(today, -30);
    const yearEnd = addDays(today, 200);
    const schoolDay = nextWeekdayAfter(today, 2); // Tuesday
    const weekend = nextWeekdayAfter(today, 6); // Saturday
    const suffix = Date.now().toString(36);
    const morningTitle = `School Morning ${suffix}`;
    const bedtimeTitle = `School Bedtime ${suffix}`;

    // --- Household → School calendar setup/save ---
    await page.getByRole("button", { name: "Household", exact: true }).click();
    await page.getByRole("button", { name: /School calendar/i }).click();
    await expect(page).toHaveURL(/\/household\/school-calendar/);
    await expect(page.getByRole("heading", { name: "School calendar" })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Start date").fill(yearStart);
    await page.getByLabel("End date").fill(yearEnd);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /School calendar saved/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(new RegExp(`${yearStart}`))).toBeVisible();

    if (testInfo.project.name === "chromium") {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "chromium-school-calendar.png"));
    }

    // --- Plan: Morning with Pack Lunchbox (school days) + everyday step ---
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await fillFocusedRoutineCreate(page, {
      title: morningTitle,
      daypart: "morning",
      audienceName: "Morgan Reed",
      stepText: "Pack Lunchbox",
    });
    await expect(page.getByRole("heading", { name: morningTitle })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openRoutineSection(page, "Steps");
    await page.locator("[data-ordered-row]").first().locator(".ordered-row-body button").click();
    await page.getByLabel("Applicability").selectOption("school_days");
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.getByRole("button", { name: "Add step", exact: true }).click();
    await page.locator("[data-ordered-row]").nth(1).locator(".ordered-row-body button").click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Stretch");
    await page.getByLabel("Applicability").selectOption("every_time");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Saved/i })).toBeVisible({
      timeout: 15_000,
    });

    if (testInfo.project.name === "chromium") {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "chromium-morning-rules.png"));
    }

    // --- Dated preview: school day vs weekend ---
    const previewDate = page.locator(".plan-preview-section").getByLabel("Date");
    await previewDate.fill(schoolDay);
    await page.getByRole("button", { name: "Show preview", exact: true }).click();
    await expect(page.locator(".plan-preview-result")).toContainText("Pack Lunchbox", {
      timeout: 10_000,
    });
    await expect(page.locator(".plan-preview-result")).toContainText("Stretch");

    await previewDate.fill(weekend);
    await page.getByRole("button", { name: "Show preview", exact: true }).click();
    await expect(page.locator(".plan-preview-result ol.preview-list")).toContainText("Stretch");
    await expect(page.locator(".plan-preview-result ol.preview-list")).not.toContainText(
      "Pack Lunchbox",
    );
    await expect(page.locator(".plan-preview-result")).toContainText("Pack Lunchbox");
    await expect(page.locator(".plan-preview-result")).toContainText(/Not a school day/i);

    if (testInfo.project.name === "chromium") {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "chromium-dated-preview.png"));
    }

    // --- Exception edit → Today checklist when today is a usual school weekday ---
    if (isoWeekday(today) >= 1 && isoWeekday(today) <= 5) {
      await page.getByRole("button", { name: "Today", exact: true }).click();
      await expect(page.getByText("Pack Lunchbox")).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: "Household", exact: true }).click();
      await page.getByRole("button", { name: /School calendar/i }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("button", { name: "Add exception", exact: true }).click();
      const exceptionBlock = page.locator(".calendar-exceptions .step-editor").last();
      await exceptionBlock.getByLabel("Name").fill("No school today");
      await exceptionBlock.getByLabel("Start date").fill(today);
      await exceptionBlock.getByLabel("End date").fill(today);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page.getByRole("status").filter({ hasText: /School calendar saved/i }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/No school today/i)).toBeVisible();

      await page.getByRole("button", { name: "Today", exact: true }).click();
      await expect(page.getByText("Stretch")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Pack Lunchbox")).toHaveCount(0);

      if (testInfo.project.name === "chromium") {
        await durableScreenshot(page, path.join(SCREENSHOT_DIR, "chromium-exception-today.png"));
      }
    }

    // --- Bedtime school_nights path (brief) ---
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await fillFocusedRoutineCreate(page, {
      title: bedtimeTitle,
      daypart: "bedtime",
      audienceName: "Morgan Reed",
      stepText: "Pack school bag",
    });
    await expect(page.getByRole("heading", { name: bedtimeTitle })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openRoutineSection(page, "Steps");
    await page.locator("[data-ordered-row]").first().locator(".ordered-row-body button").click();
    await page.getByLabel("Applicability").selectOption("school_nights");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Saved/i })).toBeVisible({
      timeout: 15_000,
    });

    const nightBeforeSchool = addDays(schoolDay, -1);
    await page.locator(".plan-preview-section").getByLabel("Date").fill(nightBeforeSchool);
    await page.getByRole("button", { name: "Show preview", exact: true }).click();
    await expect(page.locator(".plan-preview-result")).toContainText("Pack school bag", {
      timeout: 10_000,
    });

    if (testInfo.project.name === "chromium") {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "chromium-bedtime-school-night.png"));
    }
  });
});
