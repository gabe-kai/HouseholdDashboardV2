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
/** P0-006A: do not rewrite prior P0-005 screenshot evidence (AT12 zero-diff). */
const CAPTURE_LEGACY_R3_SCREENSHOTS = false;
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
  await expectSignedInAs(page, "Morgan Reed");
}

async function createNamedRoutine(page: Page, title: string, daypart = "evening") {
  const addRoutine = page.getByRole("button", { name: /^(Create routine|Add routine)$/i });
  if (!(await addRoutine.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Plan", exact: true }).click();
  }
  await expect(addRoutine).toBeVisible({ timeout: 15_000 });
  await fillFocusedRoutineCreate(page, {
    title,
    daypart,
    audienceName: "Morgan Reed",
    stepText: "Lifecycle step",
  });
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
}

test.describe("P0-005 r3 routine lifecycle UI", () => {
  test("schedule for later, delete upcoming, delete unused, and end used", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);

    const suffix = Date.now().toString(36);
    const scheduleTitle = `Lifecycle Schedule ${suffix}`;
    const unusedTitle = `Lifecycle Unused ${suffix}`;
    const endTitle = `Lifecycle End ${suffix}`;
    const tomorrow = addDays(await householdToday(page.request), 1);

    // --- Schedule for later + delete upcoming ---
    await createNamedRoutine(page, scheduleTitle, "evening");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Schedule for later" }).click();
    await expect(page.getByRole("heading", { name: "Schedule for later" })).toBeVisible();
    await page.getByLabel("Starting").fill(tomorrow);
    await openRoutineSection(page, "Steps");
    await page
      .locator("[data-ordered-row]")
      .first()
      .locator(".ordered-row-body button")
      .click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Future pack");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Schedule change", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: new RegExp(`Change scheduled for ${tomorrow}`) }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Upcoming change/i })).toBeVisible();
    await expect(page.getByText(new RegExp(`Starting ${tomorrow}`))).toBeVisible();
    if (CAPTURE_LEGACY_R3_SCREENSHOTS && testInfo.project.name === "chromium") {
      fs.mkdirSync(R3_SCREENSHOT_DIR, { recursive: true });
      await durableScreenshot(page, path.join(R3_SCREENSHOT_DIR, "03-upcoming-change.png"));
    }

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete upcoming", exact: true }).click();
    await expect(page.getByText(/unexpected error/i)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: /Deleted upcoming change/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Upcoming change/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete upcoming", exact: true })).toHaveCount(0);
    // Prior plan governs again — current detail still shows the original step.
    await expect(page.getByText("Lifecycle step")).toBeVisible();
    // Repetition is impossible: no upcoming row remains to delete again.
    await expect(page.getByText(new RegExp(`Starting ${tomorrow}`))).toHaveCount(0);

    // --- Create + delete unused test routine ---
    await page.getByRole("button", { name: /Back to Routines/i }).click();
    await expect(page.getByRole("button", { name: /^(Create routine|Add routine)$/i })).toBeVisible({
      timeout: 15_000,
    });
    await createNamedRoutine(page, unusedTitle, "anytime");
    await page.getByRole("button", { name: "More", exact: true }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("menuitem", { name: "Delete routine" }).click();
    await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: new RegExp(unusedTitle) })).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: new RegExp(`Deleted ${unusedTitle}`) }),
    ).toBeVisible({ timeout: 15_000 });

    // --- End a used (created + present on Today) routine ---
    await createNamedRoutine(page, endTitle, "bedtime");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByText(endTitle).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(endTitle) }).first().click();
    await page.getByRole("button", { name: "More", exact: true }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("menuitem", { name: "End routine" }).click();
    await expect(
      page.getByText(/^Ended$/).or(page.getByRole("status").filter({ hasText: new RegExp(`Ended ${endTitle}`) })),
    ).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Back to Ended routines/i }).click();
    await expect(page.getByRole("heading", { name: "Ended routines" })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(endTitle) })).toBeVisible({
      timeout: 15_000,
    });
  });
});
