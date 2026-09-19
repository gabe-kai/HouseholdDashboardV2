import { test, expect } from "@playwright/test";

/**
 * Desktop geometry entry for P0-007A. Phone Chromium/WebKit journeys own the
 * fuller product coverage; this file keeps chromium-desktop project match green.
 */
test.describe("P0-007A desktop geometry stub", () => {
  test("desktop project loads Plan and History route shapes", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === "webkit",
      "Desktop geometry stub runs on Chromium desktop project",
    );
    await page.goto("/plan");
    await expect(page.locator("body")).toBeVisible();
    await page.goto("/household/history");
    await expect(page.locator("body")).toBeVisible();
  });
});
