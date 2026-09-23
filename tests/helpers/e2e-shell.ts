import { expect, test, type Page } from "@playwright/test";

/** Quiet chrome: identity lives in Account, not the topbar title. */
export async function expectSignedInAs(page: Page, displayName: string | RegExp) {
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("menu")).toContainText(displayName);
  await page.getByRole("button", { name: "Account" }).click();
}

/** Resolve the durable display name for the current session (may differ after prior e2e renames). */
export async function sessionDisplayName(page: Page): Promise<string> {
  const session = await page.request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const body = (await session.json()) as {
    displayName?: string;
    member?: { displayName?: string };
    membership?: { displayName?: string };
  };
  return body.displayName ?? body.member?.displayName ?? body.membership?.displayName ?? "";
}

/** Focused create/edit: open a summary section by its label. */
export async function openRoutineSection(
  page: Page,
  label: "Name" | "When" | "Who" | "Steps" | "Work",
) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
}

export async function fillFocusedRoutineCreate(
  page: Page,
  options: {
    title: string;
    daypart?: string;
    audienceName: string;
    stepText: string;
  },
) {
  await page.getByRole("button", { name: /Create routine|Add routine/i }).click();
  await openRoutineSection(page, "Name");
  // Prefer textbox: focused-state also has aria-labelledby "Name".
  await page.getByRole("textbox", { name: "Name" }).fill(options.title);
  await page.getByRole("button", { name: "Done", exact: true }).click();

  if (options.daypart) {
    await openRoutineSection(page, "When");
    await page.getByLabel("Daypart").selectOption(options.daypart);
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }

  await page.getByRole("button", { name: /^Who/ }).click();
  await page
    .getByRole("group", { name: "People" })
    .getByRole("checkbox", { name: new RegExp(options.audienceName) })
    .first()
    .check();
  await page.getByRole("button", { name: /Apply who does this/i }).click();

  await openRoutineSection(page, "Steps");
  await page
    .locator("[data-ordered-row]")
    .first()
    .locator(".ordered-row-body button")
    .click();
  await page.getByRole("textbox", { name: "Step text" }).fill(options.stepText);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  // Leave the Steps section if still open.
  const stepsDone = page.getByRole("button", { name: "Done", exact: true });
  if (await stepsDone.isVisible().catch(() => false)) {
    await stepsDone.click();
  }

  const createButton = page.getByRole("button", { name: "Create routine", exact: true });
  await expect(createButton).toBeEnabled({ timeout: 10_000 });
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/routines") &&
        response.request().method() === "POST" &&
        response.ok(),
      { timeout: 20_000 },
    ),
    createButton.click(),
  ]);
  await expect(page.getByRole("heading", { name: "New routine" })).toHaveCount(0, {
    timeout: 15_000,
  });
}

export async function fillFocusedResponsibilityCreate(
  page: Page,
  options: {
    title: string;
    daypart?: string;
    weekdaysPreset?: "every" | "weekdays" | "weekends" | "tuesday";
    ownerName: string;
    stepTexts: string[];
  },
) {
  await page.getByRole("button", { name: /Add responsibility/i }).click();
  await openRoutineSection(page, "Name");
  await page.getByRole("textbox", { name: "Name" }).fill(options.title);
  await page.getByRole("button", { name: "Done", exact: true }).click();

  if (options.daypart || options.weekdaysPreset) {
    await openRoutineSection(page, "When");
    if (options.daypart) {
      await page.getByLabel("Daypart").selectOption(options.daypart);
    }
    if (options.weekdaysPreset === "every") {
      await page.getByRole("button", { name: "Every day" }).click();
    } else if (options.weekdaysPreset === "weekdays") {
      await page.getByRole("button", { name: "Weekdays" }).click();
    } else if (options.weekdaysPreset === "weekends") {
      await page.getByRole("button", { name: "Weekends" }).click();
    } else if (options.weekdaysPreset === "tuesday") {
      for (const day of ["Mon", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
        const box = page.getByLabel(day, { exact: true });
        if (await box.isChecked()) await box.uncheck();
      }
      const tue = page.getByLabel("Tue", { exact: true });
      if (!(await tue.isChecked())) await tue.check();
    }
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }

  await openResponsibilitySection(page, "Who");
  await chooseAssignmentMode(page, "Fixed person");
  const whoButton = page.getByRole("button", {
    name: new RegExp(`Choose accountable person|${options.ownerName}`, "i"),
  });
  await whoButton.click();
  await pickAccountablePerson(page, options.ownerName);
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await fillResponsibilityBaseSteps(page, options.stepTexts);

  await page.getByRole("button", { name: "Create responsibility", exact: true }).click();
  await confirmResponsibilitySaveIfNeeded(page);
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export async function confirmResponsibilitySaveIfNeeded(page: Page) {
  const confirm = page.getByRole("button", { name: "Confirm and save", exact: true });
  try {
    await confirm.waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    return;
  }
  await expect(confirm).toBeEnabled({ timeout: 20_000 });
  await confirm.click();
}

export async function openResponsibilitySection(
  page: Page,
  label: "Name" | "When" | "Who" | "Work",
) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
}

export async function chooseAssignmentMode(
  page: Page,
  mode: "Fixed person" | "Take turns" | "Weekly pattern",
) {
  await page.getByRole("button", { name: mode, exact: true }).click();
}

export async function pickAccountablePerson(page: Page, displayName: string) {
  await page.getByRole("radio", { name: new RegExp(displayName) }).first().check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
}

export async function setWeeklyPattern(
  page: Page,
  ownersByIsoDay: Record<number, string>,
) {
  for (const [isoDay, ownerName] of Object.entries(ownersByIsoDay)) {
    const label = WEEKDAY_LABELS[Number(isoDay) - 1]!;
    await page
      .getByRole("button", { name: new RegExp(`^${label}`) })
      .click();
    await pickAccountablePerson(page, ownerName);
  }
}

export async function addTurnOrderPeople(page: Page, names: string[]) {
  for (const name of names) {
    await page.getByRole("button", { name: /Add person/i }).click();
    await pickAccountablePerson(page, name);
  }
}

export async function fillResponsibilityBaseSteps(page: Page, stepTexts: string[]) {
  await openResponsibilitySection(page, "Work");
  await page.getByRole("button", { name: /^Base/ }).click();
  const stepList = page.getByRole("list", { name: "Base work" });
  for (let index = 0; index < stepTexts.length; index += 1) {
    if (index > 0) {
      await page.getByRole("button", { name: /Add step/i }).click();
    }
    await stepList
      .locator("[data-ordered-row]")
      .nth(index)
      .locator(".ordered-row-body button")
      .click();
    await page.getByRole("textbox", { name: "Step text" }).fill(stepTexts[index]!);
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

export async function addScheduledWorkAddition(
  page: Page,
  options: {
    name: string;
    weekdays: number[];
    inheritAssignment?: boolean;
    assignmentMode?: "Fixed person" | "Take turns" | "Weekly pattern";
    turnOrder?: string[];
    fixedOwner?: string;
    stepTexts: string[];
  },
) {
  await openResponsibilitySection(page, "Work");
  await page.getByRole("button", { name: /Add scheduled work/i }).click();
  await expect(page.getByRole("heading", { name: "Scheduled work" })).toBeVisible();
  const nameInput = page.locator("label").filter({ hasText: /^Name$/ }).locator("input");
  await nameInput.fill(options.name);

  // Clear default weekday(s), then select the requested days.
  for (const label of WEEKDAY_LABELS) {
    const box = page.getByLabel(label, { exact: true });
    if (await box.isEnabled()) {
      if (await box.isChecked()) await box.uncheck();
    }
  }
  for (const day of options.weekdays) {
    const label = WEEKDAY_LABELS[day - 1]!;
    const box = page.getByLabel(label, { exact: true });
    if (!(await box.isChecked())) await box.check();
  }
  if (options.inheritAssignment === false) {
    await page.getByRole("checkbox", { name: /Use this responsibility/i }).uncheck();
    if (options.assignmentMode) {
      await chooseAssignmentMode(page, options.assignmentMode);
    }
    if (options.assignmentMode === "Take turns" && options.turnOrder) {
      for (const name of options.turnOrder) {
        await page.getByRole("button", { name: /Add person/i }).click();
        await pickAccountablePerson(page, name);
      }
    }
    if (options.assignmentMode === "Fixed person" && options.fixedOwner) {
      await page.getByRole("button", { name: /Choose person/i }).click();
      await pickAccountablePerson(page, options.fixedOwner);
    }
  }
  // Default draft already has one step; edit it then add more.
  const stepList = page.getByRole("list", { name: "Scheduled work items" });
  for (let index = 0; index < options.stepTexts.length; index += 1) {
    if (index > 0) {
      await page.getByRole("button", { name: /Add step/i }).click();
    }
    await stepList
      .locator("[data-ordered-row]")
      .nth(index)
      .locator(".ordered-row-body button")
      .click();
    await page.getByRole("textbox", { name: "Step text" }).fill(options.stepTexts[index]!);
    await page.getByRole("button", { name: "Done", exact: true }).click();
  }
  // StepsSectionEditor Done -> Work section; Work Done leaves the section.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
}

export async function ensureManagerSession(
  page: Page,
  options: { loginName?: string; displayName?: string; passphrase?: string } = {},
) {
  const request = page.request;
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  const origin = new URL(base).origin;
  const loginName = options.loginName ?? "e2e.manager";
  const passphrase = options.passphrase ?? "unique-passphrase-ok!";
  const displayName = options.displayName ?? "Morgan Reed";

  const boot = await request.post("/api/v1/test/bootstrap-claim");
  if (boot.ok()) {
    const { token } = (await boot.json()) as { token: string };
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: origin },
      data: {
        claimToken: token,
        loginName,
        passphrase,
        displayName,
      },
    });
    if (!claim.ok()) throw new Error(await claim.text());
    return;
  }
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName, passphrase },
  });
  if (!login.ok()) throw new Error(await login.text());
}
