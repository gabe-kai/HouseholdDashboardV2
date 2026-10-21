import { test, expect, type Page } from "@playwright/test";
import {
  chooseAssignmentMode,
  confirmResponsibilitySaveIfNeeded,
  ensureManagerSession,
  expectSignedInAs,
  fillResponsibilityBaseSteps,
  openAccountablePicker,
  openResponsibilitySection,
  pickAccountablePerson,
  sessionDisplayName,
} from "../helpers/e2e-shell";

async function openAsManager(page: Page) {
  await ensureManagerSession(page);
  await page.goto("/today");
  await expectSignedInAs(page, await sessionDisplayName(page));
}

async function openRoutineSection(page: Page, label: "Name" | "When" | "Who" | "Steps") {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
}

test.describe("P0-008E UX evidence (seeded chromium)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "chromium", "Seeded Chromium phone journeys");
  });

  test("AT4: permission before/after summary updates beside controls before save", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openAsManager(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /People & Groups/ })
      .click();

    await page.getByRole("button", { name: /Avery/ }).first().click();
    await expect(page.locator("#person-detail-heading")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Edit permissions" }).click();
    await expect(page.getByTestId("person-permissions-section")).toBeVisible();
    const summary = page.getByTestId("permission-change-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(/No permission changes yet|Before \/ after/i);

    await page
      .locator("label.choice-row")
      .filter({ hasText: /Manage household displays/i })
      .locator("input")
      .check();
    await expect(summary).toContainText(/Will add:.*Manage household displays/i);
    await expect(page.getByRole("button", { name: "Preview & save" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Save preview" })).toHaveCount(0);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#person-detail-heading")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Edit permissions" }).click();
    await expect(page.getByTestId("permission-change-summary")).toContainText(
      /No permission changes yet/i,
    );
    await expect(
      page
        .locator("label.choice-row")
        .filter({ hasText: /Manage household displays/i })
        .locator("input"),
    ).toBeChecked();
  });

  test("AT6a: routine one-view keeps Name/When/Who/Steps in one editor and saves once", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const title = `008E Routine ${Date.now().toString(36)}`;
    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: /Add routine/i }).click();
    await expect(page.getByRole("heading", { name: "New routine" })).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();

    await openRoutineSection(page, "Name");
    await expect(page.getByTestId("section-expand-name")).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();
    await page.getByRole("textbox", { name: "Name" }).fill(title);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openRoutineSection(page, "When");
    await expect(page.getByTestId("section-expand-when")).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toContainText(title);
    await page.getByRole("button", { name: "Weekdays" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openRoutineSection(page, "Who");
    await expect(page.getByTestId("section-expand-who")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Who does this routine?" })).toBeVisible();
    // Scope to People fieldset — group rows also mention Avery in their Today line.
    await page
      .getByRole("group", { name: "People" })
      .getByRole("checkbox", { name: /^Avery/ })
      .check();
    await page.getByRole("button", { name: "Apply who does this" }).click();

    await openRoutineSection(page, "Steps");
    await expect(page.getByTestId("section-expand-steps")).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toContainText(title);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await expect(page.getByTestId("routine-live-preview")).toBeVisible();
    await page.getByRole("button", { name: "Create routine", exact: true }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
  });

  test("AT6b/AT7: responsibility composed draft preview updates before Save; preview is non-mutating", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const initialTitle = `008E Preview Base ${suffix}`;
    const editedTitle = `008E Preview Edited ${suffix}`;

    await openAsManager(page);
    const beforeList = await page.request.get("/api/v1/responsibilities");
    expect(beforeList.ok()).toBeTruthy();
    const beforeCount = ((await beforeList.json()) as { responsibilities: unknown[] })
      .responsibilities.length;

    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: /Add responsibility/i }).click();
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();

    await openResponsibilitySection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill(initialTitle);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openResponsibilitySection(page, "When");
    await page.getByRole("button", { name: "Every day" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openResponsibilitySection(page, "Who");
    await chooseAssignmentMode(page, "Fixed person");
    await openAccountablePicker(page);
    await pickAccountablePerson(page, "Avery");
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await fillResponsibilityBaseSteps(page, ["Wipe counters"]);

    const preview = page.getByTestId("responsibility-live-preview");
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("responsibility-preview-title")).toContainText(initialTitle);

    const previewPosts: Array<{ title: string; weekdays: number[] }> = [];
    await page.route("**/api/v1/responsibilities/preview-draft", async (route) => {
      const body = route.request().postDataJSON() as { title?: string; weekdays?: number[] };
      previewPosts.push({
        title: body.title ?? "",
        weekdays: body.weekdays ?? [],
      });
      await route.continue();
    });

    // Unsaved Name edit while Name section remains open must appear in preview before Save.
    await openResponsibilitySection(page, "Name");
    await expect(page.getByTestId("section-expand-name")).toBeVisible();
    await page.getByRole("textbox", { name: "Name" }).fill(editedTitle);
    await expect(page.getByTestId("responsibility-preview-title")).toContainText(editedTitle, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("one-view-work-summary")).toContainText(editedTitle);
    await expect
      .poll(() => previewPosts.some((p) => p.title === editedTitle), { timeout: 15_000 })
      .toBe(true);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    // Unsaved When edit while When section remains open must drive preview payload before Save.
    await openResponsibilitySection(page, "When");
    await expect(page.getByTestId("section-expand-when")).toBeVisible();
    await page.getByRole("button", { name: "Weekends" }).click();
    await expect(page.getByTestId("responsibility-preview-title")).toContainText(/Weekends/i, {
      timeout: 10_000,
    });
    await expect
      .poll(
        () => previewPosts.some((p) => p.title === editedTitle && p.weekdays.length === 2),
        { timeout: 15_000 },
      )
      .toBe(true);

    // Preview alone must not create a responsibility definition.
    const midList = await page.request.get("/api/v1/responsibilities");
    expect(midList.ok()).toBeTruthy();
    expect(
      ((await midList.json()) as { responsibilities: unknown[] }).responsibilities.length,
    ).toBe(beforeCount);

    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Create responsibility", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByRole("heading", { name: editedTitle })).toBeVisible({
      timeout: 20_000,
    });

    const afterList = await page.request.get("/api/v1/responsibilities");
    expect(afterList.ok()).toBeTruthy();
    expect(
      ((await afterList.json()) as { responsibilities: unknown[] }).responsibilities.length,
    ).toBe(beforeCount + 1);
  });
  test("AT10: 360/768/1280 and 200% text keep 008E editors usable without horizontal clip", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: /Add responsibility/i }).click();
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();
    await expect(page.getByTestId("responsibility-live-preview")).toBeVisible();

    const viewports = [
      { width: 360, height: 800 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ];
    for (const size of viewports) {
      await page.setViewportSize(size);
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth > root.clientWidth + 1;
      });
      expect(overflow, `${size.width}x${size.height} horizontal overflow`).toBe(false);
      await expect(page.getByRole("button", { name: "Create responsibility", exact: true })).toBeVisible();
      await expect(page.getByTestId("responsibility-live-preview")).toBeVisible();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    const overflowZoom = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth > root.clientWidth + 1;
    });
    expect(overflowZoom, "200% text horizontal overflow").toBe(false);
    await expect(page.getByRole("button", { name: "Create responsibility", exact: true })).toBeVisible();
  });
});
