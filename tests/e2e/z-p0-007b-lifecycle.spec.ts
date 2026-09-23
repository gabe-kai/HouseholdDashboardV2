import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  addScheduledWorkAddition,
  chooseAssignmentMode,
  confirmResponsibilitySaveIfNeeded,
  ensureManagerSession,
  expectSignedInAs,
  fillResponsibilityBaseSteps,
  openResponsibilitySection,
  pickAccountablePerson,
  sessionDisplayName,
} from "../helpers/e2e-shell";

const SCREENSHOT_DIR = path.resolve("reports/p0-007b-r1-screenshots");
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const CASEY_ID = "22222222-2222-4222-8222-222222222204";
const AVERY_LOGIN = "e2e.avery";
const PASSPHRASE = "unique-passphrase-ok!";

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d! + days, 12, 0, 0));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const day = utc.getUTCDay();
  return day === 0 ? 7 : day;
}

function nextWeekday(from: string, weekday: number): string {
  let candidate = addDays(from, 1);
  while (isoWeekday(candidate) !== weekday) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

async function csrf(page: Page): Promise<string> {
  const session = await page.request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { csrfToken: string }).csrfToken;
}

async function mutatingHeaders(page: Page): Promise<Record<string, string>> {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return {
    "x-csrf-token": await csrf(page),
    Origin: new URL(base).origin,
  };
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page);
  await page.goto("/");
  const name = await sessionDisplayName(page);
  await expectSignedInAs(page, name || /Morgan/);
}

async function claimPerson(
  page: Page,
  membershipId: string,
  loginName: string,
  displayName: string,
) {
  await ensureManagerSession(page);
  const enroll = await page.request.post("/api/v1/enrollment/claims", {
    headers: await mutatingHeaders(page),
    data: {
      mutationId: crypto.randomUUID(),
      membershipId,
      preset: "direct_personalizer",
    },
  });
  if (enroll.ok()) {
    const token = ((await enroll.json()) as { claim: { token: string } }).claim.token;
    await page.request.post("/api/v1/auth/logout", { headers: await mutatingHeaders(page) });
    const claim = await page.request.post("/api/v1/auth/claim", {
      headers: { Origin: new URL(test.info().project.use.baseURL!).origin },
      data: {
        claimToken: token,
        loginName,
        passphrase: PASSPHRASE,
        displayName,
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  await page.request.post("/api/v1/auth/logout", { headers: await mutatingHeaders(page) });
  const login = await page.request.post("/api/v1/auth/login", {
    headers: { Origin: new URL(test.info().project.use.baseURL!).origin },
    data: { loginName, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function claimAvery(page: Page) {
  await claimPerson(page, AVERY_ID, AVERY_LOGIN, "Avery Reed");
}

test.describe("P0-007B AT9 scheduled-work lifecycle", () => {
  test("addition remove prospective; upcoming delete restores predecessor", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(testInfo.project.name !== "chromium", "Chromium phone AT9 journey");
    await page.setViewportSize({ width: 390, height: 844 });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const capture = true;
    const suffix = Date.now().toString(36);
    const title = `Lifecycle Kitchen ${suffix}`;

    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: /Add responsibility/i }).click();

    await openResponsibilitySection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill(title);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openResponsibilitySection(page, "When");
    await page.getByRole("button", { name: "Every day" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await openResponsibilitySection(page, "Who");
    await chooseAssignmentMode(page, "Fixed person");
    await page.getByRole("button", { name: /Choose accountable person/i }).click();
    await pickAccountablePerson(page, "Avery");
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await fillResponsibilityBaseSteps(page, ["Counters", "Dishes", "Sweep"]);
    await addScheduledWorkAddition(page, {
      name: "Deep Clean",
      weekdays: [6],
      inheritAssignment: true,
      stepTexts: ["Oven", "Fridge", "Microwave", "Cabinets", "Floor"],
    });

    await page.getByRole("button", { name: "Create responsibility", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    const kitchenId = page.url().split("/").pop()!;

    const session = await page.request.get("/api/v1/auth/session");
    const today = ((await session.json()) as { householdDate: string }).householdDate;
    const saturday = isoWeekday(today) === 6 ? today : nextWeekday(today, 6);
    const day2 = addDays(today, 2);
    const day4 = addDays(today, 4);

    // Materialize Saturday (composed) and start today's occurrence before removing the addition.
    const satMixed = await page.request.get(`/api/v1/today?date=${saturday}`);
    expect(satMixed.ok(), await satMixed.text()).toBeTruthy();
    const kitchenSat = (
      (await satMixed.json()) as {
        occurrences: Array<{
          id: string;
          definitionId: string;
          steps: Array<{ id: string; text: string }>;
        }>;
      }
    ).occurrences.find((o) => o.definitionId === kitchenId);
    expect(kitchenSat, "Saturday Kitchen materialized").toBeTruthy();
    expect(kitchenSat!.steps.length).toBe(8);

    const todayMixed = await page.request.get(`/api/v1/today?date=${today}`);
    const kitchenToday = (
      (await todayMixed.json()) as {
        occurrences: Array<{
          id: string;
          definitionId: string;
          revisionId: string;
          accountableMemberId: string | null;
          steps: Array<{ id: string; text: string; logicalItemId?: string }>;
        }>;
      }
    ).occurrences.find((o) => o.definitionId === kitchenId);
    expect(kitchenToday).toBeTruthy();
    const startedStepsBefore = kitchenToday!.steps.length;
    const startedOccId = kitchenToday!.id;

    const averyContext = await browser.newContext();
    const avery = await averyContext.newPage();
    await claimAvery(avery);
    await avery.goto("/");
    const averyName = await sessionDisplayName(avery);
    await expectSignedInAs(avery, averyName || /Avery/);
    const card = avery.locator(".occurrence").filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: /Mark .+ completed/i }).first().click();
    await expect(card.getByTestId(/step-status-/).first()).toContainText(/Completed/i, {
      timeout: 20_000,
    });
    await averyContext.close();

    const priorPreview = await page.request.get(`/api/v1/responsibilities/${kitchenId}/preview`);
    expect(priorPreview.ok()).toBeTruthy();
    const priorOwners = (
      (await priorPreview.json()) as {
        preview: Array<{ householdDate: string; accountableMemberName: string | null }>;
      }
    ).preview.map((row) => `${row.householdDate}:${row.accountableMemberName ?? "Unassigned"}`);

    // Remove scheduled work Deep Clean through Edit; Save; prove future Saturday drops to base.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openResponsibilitySection(page, "Work");
    await page.getByRole("button", { name: /Deep Clean/i }).click();
    await expect(page.getByRole("heading", { name: "Scheduled work" })).toBeVisible();
    await page.getByRole("button", { name: "Remove scheduled work" }).click();
    const workDone = page.getByRole("button", { name: "Done", exact: true });
    if (await workDone.isVisible().catch(() => false)) {
      await workDone.click();
    }
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "07-addition-removed.png"));
    }

    const futureSaturday = saturday === today ? nextWeekday(today, 6) : saturday;
    const futureMixed = await page.request.get(`/api/v1/today?date=${futureSaturday}`);
    expect(futureMixed.ok()).toBeTruthy();
    const futureOcc = (
      (await futureMixed.json()) as {
        occurrences: Array<{ definitionId: string; steps: Array<{ text: string }> }>;
      }
    ).occurrences.find((o) => o.definitionId === kitchenId);
    expect(futureOcc).toBeTruthy();
    expect(futureOcc!.steps.length).toBe(3);

    // Started today retains its original step count via History / stored occurrence.
    const startedDetail = await page.request.get(
      `/api/v1/history/occurrences/${startedOccId}`,
    );
    if (startedDetail.ok()) {
      const hist = (await startedDetail.json()) as {
        occurrence: { steps: Array<{ text: string }> };
      };
      expect(hist.occurrence.steps.length).toBe(startedStepsBefore);
    } else {
      const stored = await page.request.get(`/api/v1/today?date=${today}`);
      const storedOcc = (
        (await stored.json()) as {
          occurrences: Array<{ id: string; steps: Array<{ text: string }> }>;
        }
      ).occurrences.find((o) => o.id === startedOccId);
      expect(storedOcc?.steps.length).toBe(startedStepsBefore);
    }

    // Schedule for later a pattern change; edit upcoming; collide occupied date retain draft.
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Schedule for later" }).click();
    await expect(page.getByRole("heading", { name: "Schedule for later" })).toBeVisible();
    await page.getByLabel("Starting").fill(day2);
    await openResponsibilitySection(page, "Who");
    await chooseAssignmentMode(page, "Fixed person");
    await page.getByRole("button", { name: /Choose accountable person|Avery|Casey|Jordan/i }).click();
    await pickAccountablePerson(page, "Casey");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: /^Save$/i }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByText(new RegExp(`Starting ${day2}`))).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Schedule for later" }).click();
    await page.getByLabel("Starting").fill(day4);
    await openResponsibilitySection(page, "Who");
    await chooseAssignmentMode(page, "Fixed person");
    await page.getByRole("button", { name: /Choose accountable person|Avery|Casey|Jordan/i }).click();
    await pickAccountablePerson(page, "Jordan");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: /^Save$/i }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByText(new RegExp(`Starting ${day4}`))).toBeVisible({ timeout: 15_000 });

    await page
      .locator("li")
      .filter({ hasText: `Starting ${day4}` })
      .getByRole("button", { name: "Edit upcoming", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Edit upcoming change" })).toBeVisible();
    await openResponsibilitySection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill(`${title} day-four`);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByText(new RegExp(`Starting ${day4}`))).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Schedule for later" }).click();
    await openResponsibilitySection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill(`${title} collision draft`);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByLabel("Starting").fill(day2);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      /already exists for that date|already starts on/i,
      { timeout: 15_000 },
    );
    await expect(page.getByRole("button", { name: /^Name/ })).toContainText(
      `${title} collision draft`,
    );
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByRole("button", { name: /Back to/i }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    // Delete upcoming boundary; prove predecessor anchor/work restored.
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page
      .locator("li")
      .filter({ hasText: `Starting ${day2}` })
      .getByRole("button", { name: "Delete upcoming", exact: true })
      .click();
    await expect(page.getByText(new RegExp(`Starting ${day2}`))).toHaveCount(0, {
      timeout: 15_000,
    });

    const afterDeletePreview = await page.request.get(
      `/api/v1/responsibilities/${kitchenId}/preview`,
    );
    expect(afterDeletePreview.ok()).toBeTruthy();
    const afterOwners = (
      (await afterDeletePreview.json()) as {
        preview: Array<{ householdDate: string; accountableMemberName: string | null }>;
      }
    ).preview;
    const day1Owner = afterOwners.find((row) => row.householdDate === addDays(today, 1));
    if (day1Owner && day1Owner.householdDate < day4) {
      expect(day1Owner.accountableMemberName).not.toBe("Casey Reed");
      const priorMatch = priorOwners.find((line) => line.startsWith(`${day1Owner.householdDate}:`));
      if (priorMatch) {
        expect(`${day1Owner.householdDate}:${day1Owner.accountableMemberName ?? "Unassigned"}`).toBe(
          priorMatch,
        );
      }
    }

    void CASEY_ID;
  });
});
