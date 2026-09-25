import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  ensureManagerSession,
  expectSignedInAs,
  fillFocusedResponsibilityCreate,
  sessionDisplayName,
} from "../helpers/e2e-shell";

/** Local-only evidence; never write tracked reports/p0-* screenshot dirs. */
const SCREENSHOT_DIR = path.resolve("reports/_local-screenshots/p0-007c-1-r1");

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, "documentElement must not require horizontal scroll").toBe(false);
}

test.describe("P0-007C-1 geometry", () => {
  test("AT12: Today and Household readable at 360 and 1280 without overflow", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      testInfo.project.name === "webkit",
      "Geometry coverage runs on Chromium projects (phone + desktop allowlist)",
    );

    const capture = testInfo.project.name === "chromium";
    if (capture) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    await ensureManagerSession(page);
    await page.goto("/");
    const name = await sessionDisplayName(page);
    await expectSignedInAs(page, name || /Morgan/);

    const suffix = Date.now().toString(36);
    const title = `C1 Geo ${suffix}`;

    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await fillFocusedResponsibilityCreate(page, {
      title,
      weekdaysPreset: "every",
      daypart: "evening",
      ownerName: "Avery",
      stepTexts: ["Wipe"],
    });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });

    // —— 360: Today ——
    await page.setViewportSize({ width: 360, height: 800 });
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Today", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await assertNoHorizontalOverflow(page);
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "today-360.png"));
    }

    // —— 360: Household ——
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Household", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".compact-activity-row").filter({ hasText: title })).toBeVisible({
      timeout: 20_000,
    });
    await assertNoHorizontalOverflow(page);
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "household-360.png"));
    }

    // —— 1280: Today ——
    await page.setViewportSize({ width: 1280, height: 800 });
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Today", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await assertNoHorizontalOverflow(page);
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "today-1280.png"));
    }

    // —— 1280: Household ——
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Household", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await assertNoHorizontalOverflow(page);
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "household-1280.png"));
    }
  });
});
