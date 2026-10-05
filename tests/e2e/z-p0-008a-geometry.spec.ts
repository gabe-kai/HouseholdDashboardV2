import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("P0-008A geometry", () => {
  test("P0-008A owner and welcome panels render on desktop", async ({ page }) => {
    await page.goto("/owner");
    await expect(page.getByRole("heading", { name: /Protected setup access/i })).toBeVisible();
    await page.goto("/welcome");
    await expect(page.getByTestId("protected-welcome")).toBeVisible();
  });
});
