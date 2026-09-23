import { test, expect } from "@playwright/test";
import {
  addScheduledWorkAddition,
  chooseAssignmentMode,
  confirmResponsibilitySaveIfNeeded,
  ensureManagerSession,
  expectSignedInAs,
  fillResponsibilityBaseSteps,
  openResponsibilitySection,
  sessionDisplayName,
  setWeeklyPattern,
} from "../helpers/e2e-shell";

/**
 * P0-007B AT15 geometry: B controls (Edit, Upcoming, Add scheduled work)
 * visible at 360px phone and 1280px desktop.
 */
test.describe("P0-007B B-control geometry", () => {
  test("Edit, Upcoming, Add scheduled work visible at 360 and 1280", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(testInfo.project.name === "webkit", "Geometry coverage runs on Chromium projects");

    await ensureManagerSession(page);
    await page.goto("/");
    const name = await sessionDisplayName(page);
    await expectSignedInAs(page, name || /Morgan/);

    const suffix = Date.now().toString(36);
    const title = `Geo B ${suffix}`;

    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: /Add responsibility/i }).click();

    await openResponsibilitySection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill(title);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await openResponsibilitySection(page, "When");
    await page.getByRole("button", { name: "Every day" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await openResponsibilitySection(page, "Who");
    await chooseAssignmentMode(page, "Weekly pattern");
    await setWeeklyPattern(page, {
      1: "Avery",
      2: "Casey",
      3: "Avery",
      4: "Casey",
      5: "Jordan",
      6: "Avery",
      7: "Casey",
    });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await fillResponsibilityBaseSteps(page, ["Counters"]);

    await openResponsibilitySection(page, "Work");
    await expect(page.getByRole("button", { name: /Add scheduled work/i })).toBeVisible();
    const addBox = await page.getByRole("button", { name: /Add scheduled work/i }).boundingBox();
    expect(addBox, "Add scheduled work touch target at 360").toBeTruthy();
    expect(addBox!.height).toBeGreaterThanOrEqual(28);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await addScheduledWorkAddition(page, {
      name: "Deep Clean",
      weekdays: [6],
      inheritAssignment: true,
      stepTexts: ["Oven"],
    });
    await page.getByRole("button", { name: "Create responsibility", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
    const editBox = await page.getByRole("button", { name: "Edit", exact: true }).boundingBox();
    expect(editBox!.height).toBeGreaterThanOrEqual(28);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openResponsibilitySection(page, "Work");
    await expect(page.getByRole("button", { name: /Add scheduled work/i })).toBeVisible();

    // 200% text: B controls remain reachable without overflow.
    await page.getByRole("button", { name: "Done", exact: true }).click();
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByRole("button", { name: /Back to|Cancel/i }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
    const editAt200 = await page.getByRole("button", { name: "Edit", exact: true }).boundingBox();
    expect(editAt200, "Edit visible at 200% text").toBeTruthy();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openResponsibilitySection(page, "Work");
    await expect(page.getByRole("button", { name: /Add scheduled work/i })).toBeVisible();
  });
});
