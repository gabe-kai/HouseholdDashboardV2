import { expect, type Page } from "@playwright/test";

/** Quiet chrome: identity lives in Account, not the topbar title. */
export async function expectSignedInAs(page: Page, displayName: string) {
  await expect(page.getByRole("button", { name: "Account" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByRole("menu")).toContainText(displayName);
  await page.getByRole("button", { name: "Account" }).click();
}

/** Focused create/edit: open a summary section by its label. */
export async function openRoutineSection(page: Page, label: "Name" | "When" | "Who" | "Steps") {
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
  await page.getByRole("button", { name: /Create routine/i }).click();
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
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await page.getByRole("button", { name: "Create routine", exact: true }).click();
}
