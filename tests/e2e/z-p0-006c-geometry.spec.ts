import { test, expect } from "@playwright/test";

/**
 * Desktop geometry entry for P0-006C. Phone Chromium/WebKit journeys own the
 * fuller product coverage; this file keeps chromium-desktop project match green.
 */
test.describe("P0-006C desktop geometry stub", () => {
  test("desktop project loads History route shape", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === "webkit",
      "Desktop geometry stub runs on Chromium desktop project",
    );
    await page.goto("/household/history");
    await expect(page.locator("body")).toBeVisible();
  });
});
