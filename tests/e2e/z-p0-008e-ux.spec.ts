import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  addScheduledWorkAddition,
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

function addIsoDay(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function fillNewResponsibility(page: Page, title: string) {
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: /Add responsibility/i }).click();
  await expect(page.getByTestId("one-view-work-summary")).toBeVisible();

  await openResponsibilitySection(page, "Name");
  await page.getByRole("textbox", { name: "Name" }).fill(title);
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
}

async function openPeople(page: Page) {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Household", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Household" })
    .getByRole("button", { name: /People & Groups/ })
    .click();
  await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible({
    timeout: 15_000,
  });
}

async function occurrenceFingerprint(page: Page) {
  const today = await page.request.get("/api/v1/today");
  expect(today.ok()).toBeTruthy();
  const body = (await today.json()) as {
    activityGeneration: number;
    occurrences: Array<{
      id: string;
      title: string;
      startedAt: string | null;
      accountableMemberId: string | null;
      version: number;
    }>;
  };
  return {
    activityGeneration: body.activityGeneration,
    rows: body.occurrences
      .map(
        (row) =>
          `${row.id}|${row.title}|${row.startedAt}|${row.accountableMemberId}|${row.version}`,
      )
      .sort(),
  };
}

type ResponsibilityListItem = {
  id: string;
  revisions: Array<{ title: string; effectiveDate: string }>;
  scheduleEntries: Array<{
    startDate: string;
    canceledAt: string | null;
    revision: { title: string; effectiveDate: string };
  }>;
};

async function listResponsibilities(page: Page): Promise<ResponsibilityListItem[]> {
  const listed = await page.request.get("/api/v1/responsibilities");
  expect(listed.ok()).toBeTruthy();
  return ((await listed.json()) as { responsibilities: ResponsibilityListItem[] }).responsibilities;
}

function currentSchedule(definition: ResponsibilityListItem) {
  return definition.scheduleEntries
    .filter((entry) => !entry.canceledAt)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const root = document.documentElement;
    const overflowing: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (style.position === "fixed" || style.position === "sticky") continue;
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.right > viewport + 1) {
        const name =
          (el as HTMLElement).dataset.testid ||
          el.id ||
          `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ").filter(Boolean).slice(0, 2).join(".")}` : ""}`;
        overflowing.push(`${name} right=${Math.round(rect.right)}`);
      }
    }
    return {
      documentWider: root.scrollWidth > root.clientWidth + 1,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      overflowing: overflowing.slice(0, 8),
    };
  });
  expect(
    result.documentWider,
    `${label} document scrollWidth ${result.scrollWidth}>${result.clientWidth}`,
  ).toBe(false);
  expect(result.overflowing, `${label} overflowing boxes`).toEqual([]);
}

async function assertUsableControl(control: Locator, label: string) {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box, label).toBeTruthy();
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(36);
  await control.focus();
  await expect(control).toBeFocused();
}

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const session = await page.request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const body = (await session.json()) as { csrfToken: string };
  return {
    Origin: new URL(page.url()).origin,
    "x-csrf-token": body.csrfToken,
  };
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

  test("AT3a/b: People optional details stay collapsed/blank and persist when entered", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const blankName = `008E Blank ${suffix}`;
    const filledName = `008E Profile ${suffix}`;
    await openAsManager(page);
    await openPeople(page);

    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await expect(page.getByTestId("add-person-form")).toBeVisible();
    const optional = page.getByTestId("add-person-more-details");
    await expect(optional).toBeVisible();
    await expect(optional).not.toHaveAttribute("open");
    await expect(page.getByTestId("add-person-full-name")).toBeHidden();
    await page.getByTestId("add-person-display-name").fill(blankName);
    await page.getByTestId("add-person-form").locator("button[type=submit]").click();
    await expect(page.locator("#person-detail-heading")).toHaveText(blankName, { timeout: 15_000 });
    const blankProfile = page.locator("section").filter({ hasText: /^Profile/ });
    await expect(blankProfile).toContainText("Full name:");
    await expect(blankProfile).toContainText("Not set");
    await expect(blankProfile).toContainText("Birthday:");
    await expect(blankProfile).toContainText("Email:");
    await page.getByRole("button", { name: "Edit profile" }).click();
    await expect(page.getByRole("heading", { name: "Edit person" })).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveValue("");
    await expect(page.getByLabel("Birthday")).toHaveValue("");
    await expect(page.getByLabel("Email")).toHaveValue("");
    await page.getByRole("button", { name: /Back to / }).click();
    await page.getByRole("button", { name: /Back to People/ }).click();

    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await expect(page.getByTestId("add-person-more-details")).not.toHaveAttribute("open");
    await page.getByTestId("add-person-display-name").fill(filledName);
    await page.getByRole("radio", { name: "Adult" }).check();
    await page.getByText("More details (optional)").click();
    await expect(page.getByTestId("add-person-more-details")).toHaveAttribute("open");
    await page.getByTestId("add-person-full-name").fill("Full Legal Name");
    await page.getByTestId("add-person-birthday").fill("2014-03-15");
    await page.getByTestId("add-person-email").fill("profile@example.test");
    await page.getByTestId("add-person-form").locator("button[type=submit]").click();
    await expect(page.locator("#person-detail-heading")).toHaveText(filledName, { timeout: 15_000 });
    const filledProfile = page.locator("section").filter({ hasText: /^Profile/ });
    await expect(filledProfile).toContainText("Full Legal Name");
    await expect(filledProfile).toContainText("2014-03-15");
    await expect(filledProfile).toContainText("profile@example.test");
    await page.getByRole("button", { name: "Edit profile" }).click();
    await expect(page.getByLabel("Name shown in the app")).toHaveValue(filledName);
    await expect(page.getByLabel("Full name")).toHaveValue("Full Legal Name");
    await expect(page.getByLabel("Birthday")).toHaveValue("2014-03-15");
    await expect(page.getByLabel("Email")).toHaveValue("profile@example.test");
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
    await page
      .locator("[data-ordered-row]")
      .first()
      .locator(".ordered-row-body button")
      .click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Get dressed");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const createStepsDone = page.getByRole("button", { name: "Done", exact: true });
    if (await createStepsDone.isVisible().catch(() => false)) {
      await createStepsDone.click();
    }

    await expect(page.getByTestId("routine-live-preview")).toBeVisible();
    const previewFingerprint = await occurrenceFingerprint(page);
    expect(previewFingerprint.rows.some((row) => row.includes(title))).toBe(false);
    await page.getByRole("button", { name: "Create routine", exact: true }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit routine" })).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();
    const editedTitle = `${title} edited`;
    await openRoutineSection(page, "Name");
    await expect(page.getByTestId("section-expand-name")).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();
    await page.getByRole("textbox", { name: "Name" }).fill(editedTitle);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openRoutineSection(page, "When");
    await expect(page.getByTestId("section-expand-when")).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toContainText(editedTitle);
    await page.getByRole("button", { name: "Weekends" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openRoutineSection(page, "Who");
    await expect(page.getByTestId("routine-who-inline")).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();
    await page
      .getByRole("group", { name: "People" })
      .getByRole("checkbox", { name: /^Jordan/ })
      .check();
    await page.getByRole("button", { name: "Apply who does this" }).click();

    await openRoutineSection(page, "Steps");
    await expect(page.getByTestId("section-expand-steps")).toBeVisible();
    await page
      .locator("[data-ordered-row]")
      .first()
      .locator(".ordered-row-body button")
      .click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Brush hair");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const stepsDone = page.getByRole("button", { name: "Done", exact: true });
    if (await stepsDone.isVisible().catch(() => false)) {
      await stepsDone.click();
    }

    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("heading", { name: editedTitle })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Weekends/i)).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByTestId("one-view-work-summary")).toContainText(editedTitle);
    await expect(page.getByTestId("one-view-work-summary")).toContainText(/Weekends/i);
    await expect(page.getByTestId("one-view-work-summary")).toContainText(/1 item/i);
    await openRoutineSection(page, "Steps");
    await expect(page.getByTestId("section-expand-steps")).toContainText("Brush hair");
  });

  test("AT6b: edit existing responsibility with scheduled addition stays one-view", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const title = `008E Addition ${suffix}`;
    const editedTitle = `${title} edited`;
    const additionName = `Weekend extra ${suffix}`;
    await openAsManager(page);
    await fillNewResponsibility(page, title);
    await addScheduledWorkAddition(page, {
      name: additionName,
      weekdays: [6, 7],
      inheritAssignment: true,
      stepTexts: ["Take out recycling"],
    });
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();
    await page.getByRole("button", { name: "Create responsibility", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(additionName)).toBeVisible();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit responsibility" })).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();

    await openResponsibilitySection(page, "Name");
    await expect(page.getByTestId("section-expand-name")).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();
    await page.getByRole("textbox", { name: "Name" }).fill(editedTitle);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openResponsibilitySection(page, "When");
    await expect(page.getByTestId("section-expand-when")).toBeVisible();
    await expect(page.getByTestId("one-view-work-summary")).toContainText(editedTitle);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openResponsibilitySection(page, "Who");
    await expect(page.getByRole("heading", { name: "Assignment pattern" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fixed person", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Avery/ })).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openResponsibilitySection(page, "Work");
    await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
    await expect(page.getByText(additionName)).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByRole("heading", { name: editedTitle })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(additionName)).toBeVisible();
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
    const fingerprintBeforeUnsavedEdits = await occurrenceFingerprint(page);

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

    // Preview alone must not create a responsibility definition or mutate today work.
    const midList = await page.request.get("/api/v1/responsibilities");
    expect(midList.ok()).toBeTruthy();
    expect(
      ((await midList.json()) as { responsibilities: unknown[] }).responsibilities.length,
    ).toBe(beforeCount);
    expect(fingerprintBeforeUnsavedEdits.rows.some((row) => row.includes(editedTitle))).toBe(
      false,
    );
    expect(await occurrenceFingerprint(page)).toEqual(fingerprintBeforeUnsavedEdits);

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
    page.on("dialog", (dialog) => void dialog.accept());
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
      await assertNoHorizontalOverflow(page, `${size.width}x${size.height} horizontal overflow`);
      await expect(page.getByRole("button", { name: "Create responsibility", exact: true })).toBeVisible();
      await expect(page.getByTestId("responsibility-live-preview")).toBeVisible();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await assertNoHorizontalOverflow(page, "200% text horizontal overflow");
    await expect(page.getByRole("button", { name: "Create responsibility", exact: true })).toBeVisible();

    await page.setViewportSize({ width: 360, height: 800 });
    await assertUsableControl(
      page.getByRole("button", { name: "Create responsibility", exact: true }),
      "responsibility create",
    );
    await page.getByRole("button", { name: /Back to Plan/ }).click();

    await page.getByRole("button", { name: /Add routine/i }).click();
    await expect(page.getByTestId("one-view-work-summary")).toBeVisible();
    await expect(page.getByTestId("routine-live-preview")).toBeVisible();
    await assertNoHorizontalOverflow(page, "routine editor 360 overflow");
    await assertUsableControl(page.getByRole("button", { name: "Create routine", exact: true }), "routine create");
    await page.getByRole("button", { name: /Back to Routines|Back to Plan/ }).click();

    await openPeople(page);
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await expect(page.getByTestId("add-person-form")).toBeVisible();
    await expect(page.getByTestId("add-person-more-details")).toBeVisible();
    await expect(page.getByTestId("add-person-display-name")).toBeVisible();
    await assertNoHorizontalOverflow(page, "add-person 360 overflow");
    await assertUsableControl(
      page.getByTestId("add-person-form").locator("button[type=submit]"),
      "add person submit",
    );
    await page.getByRole("button", { name: /Back to People/ }).click();

    await page.getByRole("button", { name: /Avery/ }).first().click();
    await expect(page.locator("#person-detail-heading")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Edit permissions" }).click();
    await expect(page.getByTestId("person-permissions-section")).toBeVisible();
    await expect(page.getByTestId("permission-change-summary")).toBeVisible();
    await assertNoHorizontalOverflow(page, "permissions 360 overflow");
    await assertUsableControl(page.getByRole("button", { name: "Cancel", exact: true }), "permission cancel");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeVisible();
    const saveBox = await save.boundingBox();
    expect(saveBox, "permission save size").toBeTruthy();
    expect(saveBox!.height, "permission save height").toBeGreaterThanOrEqual(36);
  });

  test("AT2b: settings timezone is locked after dated household work exists", async ({ page }) => {
    test.setTimeout(180_000);
    await openAsManager(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /Settings/ })
      .click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByTestId("household-details-section")).toContainText(
      /Timezone is read-only after dated calendar, work, or activity exists/i,
    );
    await expect(page.getByTestId("household-details-section").locator("select")).toHaveCount(0);
  });

  test("AT5: last manager and stale permission version are denied; draft stays", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openAsManager(page);
    page.on("dialog", (dialog) => void dialog.accept());
    const managerName = await sessionDisplayName(page);
    const session = await page.request.get("/api/v1/auth/session");
    expect(session.ok()).toBeTruthy();
    const selfId = ((await session.json()) as { member: { id: string } }).member.id;
    const headers = await csrfHeaders(page);
    const essential = [
      "household.member.enroll",
      "household.structure.manage",
      "household.access.manage",
      "household.lifecycle.manage",
    ];

    async function listPeople() {
      const listed = await page.request.get("/api/v1/people");
      expect(listed.ok()).toBeTruthy();
      return (
        (await listed.json()) as {
          people: Array<{
            id: string;
            grants: string[];
            authorityVersion: number;
            roleLabel: string;
          }>;
        }
      ).people;
    }

    const before = await listPeople();
    const selfRow = before.find((person) => person.id === selfId);
    expect(selfRow).toBeTruthy();
    const restoreManagerIds: string[] = [];
    if (!essential.every((grant) => selfRow!.grants.includes(grant))) {
      const restoreSelf = await page.request.post(`/api/v1/people/${selfId}/permissions`, {
        headers,
        data: {
          mutationId: crypto.randomUUID(),
          expectedAuthorityVersion: selfRow!.authorityVersion,
          role: "manager",
        },
      });
      expect(restoreSelf.ok(), await restoreSelf.text()).toBeTruthy();
    }

    try {
    for (const person of await listPeople()) {
      if (person.id === selfId) continue;
      if (!essential.every((grant) => person.grants.includes(grant))) continue;
      const demoteOther = await page.request.post(`/api/v1/people/${person.id}/permissions`, {
        headers,
        data: {
          mutationId: crypto.randomUUID(),
          expectedAuthorityVersion: person.authorityVersion,
          role: "member",
          memberMode: "direct",
          secondaryGrants: [],
        },
      });
      expect(demoteOther.ok(), await demoteOther.text()).toBeTruthy();
      restoreManagerIds.push(person.id);
    }

    const remaining = (await listPeople()).filter((person) =>
      essential.every((grant) => person.grants.includes(grant)),
    );
    expect(remaining.map((person) => person.id)).toEqual([selfId]);

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /People & Groups/ })
      .click();

    await page.getByRole("button", { name: new RegExp(managerName) }).first().click();
    await expect(page.locator("#person-detail-heading")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Edit permissions" }).click();
    await expect(page.getByTestId("person-permissions-section")).toBeVisible();
    await page.getByRole("radio", { name: /Member/ }).check();
    const additional = page
      .getByTestId("person-permissions-section")
      .locator("fieldset")
      .filter({ hasText: /^Additional permissions/ })
      .locator('input[type="checkbox"]');
    for (const box of await additional.all()) {
      if (await box.isChecked()) await box.uncheck();
    }
    await expect(page.getByTestId("permission-change-summary")).toContainText(/Member/i);
    await expect(page.getByTestId("permission-change-summary")).toContainText(/Will remove:/i);
    const lastManagerDenied = page.waitForResponse(
      (response) => {
        const path = new URL(response.url()).pathname;
        return (
          response.request().method() === "POST" &&
          /\/api\/v1\/people\/[^/]+\/permissions$/.test(path) &&
          response.status() === 403
        );
      },
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await lastManagerDenied).status()).toBe(403);
    await expect(page.getByRole("alert")).toContainText(/essential manager|at least one active/i, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("person-permissions-section")).toBeVisible();
    await expect(page.getByRole("radio", { name: /Member/ })).toBeChecked();
    const stillSelf = await page.request.get(`/api/v1/people/${selfId}`);
    expect(stillSelf.ok()).toBeTruthy();
    expect(((await stillSelf.json()) as { person: { roleLabel: string } }).person.roleLabel).toBe(
      "manager",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator("#person-detail-heading")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Back to People/ }).click();

    await page.getByRole("button", { name: /Avery/ }).first().click();
    await expect(page.locator("#person-detail-heading")).toBeVisible({ timeout: 15_000 });
    const peopleResponse = await page.request.get("/api/v1/people");
    expect(peopleResponse.ok()).toBeTruthy();
    const people = (await peopleResponse.json()) as {
      people: Array<{ id: string; displayName: string; authorityVersion: number; grants: string[] }>;
    };
    const avery = people.people.find((item) => /Avery/i.test(item.displayName));
    expect(avery).toBeTruthy();

    await page.getByRole("button", { name: "Edit permissions" }).click();
    await expect(page.getByTestId("person-permissions-section")).toBeVisible();

    const competeHeaders = await csrfHeaders(page);
    const compete = await page.request.post(`/api/v1/people/${avery!.id}/permissions`, {
      headers: competeHeaders,
      data: {
        mutationId: crypto.randomUUID(),
        expectedAuthorityVersion: avery!.authorityVersion,
        role: "member",
        memberMode: "direct",
        secondaryGrants: avery!.grants.filter((grant) => grant !== "household.display.manage"),
      },
    });
    expect(compete.ok(), await compete.text()).toBeTruthy();

    const stale = await page.request.post(`/api/v1/people/${avery!.id}/permissions`, {
      headers: competeHeaders,
      data: {
        mutationId: crypto.randomUUID(),
        expectedAuthorityVersion: avery!.authorityVersion,
        role: "member",
        memberMode: "direct",
        secondaryGrants: avery!.grants.filter((grant) => grant !== "household.display.manage"),
      },
    });
    expect(stale.status()).toBe(409);
    await expect(page.getByTestId("person-permissions-section")).toBeVisible();
    const afterStale = await page.request.get(`/api/v1/people/${avery!.id}`);
    expect(afterStale.ok()).toBeTruthy();
    expect(
      ((await afterStale.json()) as { person: { grants: string[] } }).person.grants,
    ).not.toContain("household.display.manage");
    } finally {
      const restoreHeaders = await csrfHeaders(page);
      for (const id of restoreManagerIds) {
        const current = (await listPeople()).find((person) => person.id === id);
        if (!current) continue;
        await page.request.post(`/api/v1/people/${id}/permissions`, {
          headers: restoreHeaders,
          data: {
            mutationId: crypto.randomUUID(),
            expectedAuthorityVersion: current.authorityVersion,
            role: "manager",
          },
        });
      }
    }
  });

  test("AT8: household-date rollover keeps draft, requires confirm, and saves once", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const title = `008E Rollover ${Date.now().toString(36)}`;
    await openAsManager(page);
    const beforeList = await page.request.get("/api/v1/responsibilities");
    expect(beforeList.ok()).toBeTruthy();
    const beforeCount = ((await beforeList.json()) as { responsibilities: unknown[] })
      .responsibilities.length;

    const session = await page.request.get("/api/v1/auth/session");
    expect(session.ok()).toBeTruthy();
    const today = ((await session.json()) as { householdDate: string }).householdDate;
    const nextDate = addIsoDay(today, 1);

    await fillNewResponsibility(page, title);
    await expect(page.getByTestId("responsibility-live-preview")).toBeVisible();
    await expect(page.getByTestId("responsibility-preview-title")).toContainText(title);

    await page.route("**/api/v1/auth/session", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { householdDate?: string };
      await route.fulfill({
        response,
        json: { ...body, householdDate: nextDate },
      });
    });

    await page.getByRole("button", { name: "Create responsibility", exact: true }).click();
    const rollover = page.getByTestId("responsibility-date-rollover");
    await expect(rollover).toBeVisible({ timeout: 15_000 });
    await expect(rollover).toContainText(nextDate);
    await expect(page.getByTestId("responsibility-save-date")).toContainText(nextDate);
    await expect(page.getByTestId("responsibility-preview-title")).toContainText(title);
    await expect(page.getByTestId("responsibility-preview-basis")).toContainText(nextDate);
    await expect(page.getByRole("button", { name: "Create responsibility", exact: true })).toBeDisabled();

    const midList = await page.request.get("/api/v1/responsibilities");
    expect(
      ((await midList.json()) as { responsibilities: unknown[] }).responsibilities.length,
    ).toBe(beforeCount);

    const confirm = page.getByTestId("responsibility-rereview-save");
    await confirm.click();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click({ timeout: 2_000 }).catch(() => undefined);
    }
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("responsibility-rereview-save")).toHaveCount(0);
    const after = await listResponsibilities(page);
    expect(after.length).toBe(beforeCount + 1);
    const created = after.find((item) =>
      item.revisions.some((revision) => revision.title === title) ||
      item.scheduleEntries.some((entry) => entry.revision.title === title),
    );
    expect(created).toBeTruthy();
    const detail = await page.request.get(`/api/v1/responsibilities/${created!.id}`);
    expect(detail.ok()).toBeTruthy();
    const body = (await detail.json()) as {
      responsibility: {
        revisions: Array<{
          title: string;
          effectiveDate: string;
          assignment?: { anchorDate?: string };
        }>;
        scheduleEntries: Array<{
          startDate: string;
          revision: { title: string; effectiveDate: string; assignment?: { anchorDate?: string } };
        }>;
      };
    };
    const revision =
      body.responsibility.revisions.find((row) => row.title === title) ??
      currentSchedule(body.responsibility)?.revision;
    expect(revision?.assignment?.anchorDate ?? revision?.effectiveDate).toBe(nextDate);
  });

  test("AT8: future startingDate stays put across household-date rollover", async ({ page }) => {
    test.setTimeout(180_000);
    const title = `008E Future Start ${Date.now().toString(36)}`;
    await openAsManager(page);
    const session = await page.request.get("/api/v1/auth/session");
    expect(session.ok()).toBeTruthy();
    const today = ((await session.json()) as { householdDate: string }).householdDate;
    const nextDate = addIsoDay(today, 1);
    const futureDate = addIsoDay(today, 5);

    await fillNewResponsibility(page, title);
    await page.getByRole("button", { name: "Create responsibility", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    const before = await listResponsibilities(page);

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Schedule for later" }).click();
    await expect(page.getByRole("heading", { name: "Schedule for later" })).toBeVisible();
    await page.locator("#routine-starting-date").fill(futureDate);
    await expect(page.locator("#routine-starting-date")).toHaveValue(futureDate);

    await page.route("**/api/v1/auth/session", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { householdDate?: string };
      await route.fulfill({
        response,
        json: { ...body, householdDate: nextDate },
      });
    });

    await page.getByRole("button", { name: "Save", exact: true }).click();
    const rollover = page.getByTestId("responsibility-date-rollover");
    await expect(rollover).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("responsibility-save-date")).toContainText(futureDate);
    await expect(page.getByTestId("responsibility-save-date")).toContainText("your chosen start date");
    await page.getByTestId("responsibility-rereview-save").click();
    await expect(page.getByText(`Starting ${futureDate}`)).toBeVisible({ timeout: 20_000 });

    const after = await listResponsibilities(page);
    expect(after.length).toBe(before.length);
    const saved = after.find((item) => item.revisions.some((revision) => revision.title === title));
    expect(saved).toBeTruthy();
    const upcoming = saved!.scheduleEntries.find((entry) => entry.startDate === futureDate);
    expect(upcoming?.revision.effectiveDate).toBe(futureDate);
  });
});
