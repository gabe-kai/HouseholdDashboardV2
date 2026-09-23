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
  setWeeklyPattern,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const CASEY_ID = "22222222-2222-4222-8222-222222222204";
const JORDAN_ID = "22222222-2222-4222-8222-222222222203";
const SCREENSHOT_DIR = path.resolve("reports/p0-007b-r1-screenshots");

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

function previousOrSameWeekday(from: string, weekday: number): string {
  let candidate = from;
  while (isoWeekday(candidate) !== weekday) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
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
  await expectSignedInAs(page, "Morgan Reed");
}

test.describe("P0-007B Kitchen and Bathroom journeys", () => {
  test("AT4/AT5: Kitchen weekly + Deep Clean; Bathroom Sunday inherit", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(
      testInfo.project.name === "chromium-desktop",
      "Phone Chromium/WebKit own this journey",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const capture = testInfo.project.name === "chromium";

    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: /Add responsibility/i }).click();

    await openResponsibilitySection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill("Kitchen");
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

    await fillResponsibilityBaseSteps(page, ["Counters", "Dishes", "Sweep"]);

    await addScheduledWorkAddition(page, {
      name: "Deep Clean",
      weekdays: [6],
      inheritAssignment: false,
      assignmentMode: "Take turns",
      turnOrder: ["Avery", "Casey"],
      stepTexts: ["Oven", "Fridge", "Microwave", "Cabinets", "Floor"],
    });

    await page.getByRole("button", { name: "Create responsibility", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByRole("heading", { name: "Kitchen" })).toBeVisible({ timeout: 20_000 });
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "01-kitchen-detail.png"));
    }

    const previewRows = page.locator(".responsibility-preview-list li");
    await expect(previewRows.first()).toBeVisible();
    const viewAll = page.getByRole("button", { name: /View all/i });
    if (await viewAll.isVisible()) await viewAll.click();
    const previewText = await previewRows.allTextContents();
    const saturdayLines = previewText.filter(
      (line) => isoWeekday(line.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "") === 6,
    );
    expect(saturdayLines.length).toBeGreaterThanOrEqual(1);
    expect(saturdayLines.some((line) => /Avery|Casey/i.test(line))).toBeTruthy();
    // Deep-clean Saturdays should show the composed 8-item count when expanded.
    expect(saturdayLines.some((line) => /8 items/i.test(line))).toBeTruthy();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Kitchen" })).toBeVisible({ timeout: 20_000 });

    const session = await page.request.get("/api/v1/auth/session");
    const today = ((await session.json()) as { householdDate: string }).householdDate;
    const saturday = isoWeekday(today) === 6 ? today : nextWeekday(today, 6);
    const kitchenUrl = page.url();
    const kitchenId = kitchenUrl.split("/").pop()!;

    const satMixed = await page.request.get(`/api/v1/today?date=${saturday}`);
    expect(satMixed.ok(), await satMixed.text()).toBeTruthy();
    let kitchenOcc = (
      (await satMixed.json()) as {
        occurrences: Array<{
          id: string;
          title: string;
          definitionId: string;
          accountableMemberId: string | null;
          steps: Array<{ text: string }>;
        }>;
      }
    ).occurrences.find((o) => o.definitionId === kitchenId);
    if (!kitchenOcc) {
      const materialize = await page.request.get(`/api/v1/today?date=${saturday}`);
      kitchenOcc = (
        (await materialize.json()) as {
          occurrences: Array<{
            id: string;
            title: string;
            definitionId: string;
            accountableMemberId: string | null;
            steps: Array<{ text: string }>;
          }>;
        }
      ).occurrences.find((o) => o.definitionId === kitchenId);
    }
    expect(kitchenOcc, "Kitchen on controlled Saturday").toBeTruthy();
    expect(kitchenOcc!.steps.length).toBe(8);
    expect(kitchenOcc!.accountableMemberId).toMatch(
      new RegExp(`${AVERY_ID}|${CASEY_ID}`),
    );

    const weekday = previousOrSameWeekday(today, 1);
    const weekdayMixed = await page.request.get(`/api/v1/today?date=${weekday}`);
    const weekdayOcc = (
      (await weekdayMixed.json()) as {
        occurrences: Array<{ definitionId: string; steps: Array<{ text: string }> }>;
      }
    ).occurrences.find((o) => o.definitionId === kitchenId);
    if (weekdayOcc && isoWeekday(weekday) !== 6) {
      expect(weekdayOcc.steps.length).toBe(3);
    }

    await page.getByRole("button", { name: /Back to Plan/i }).click();
    await page.getByRole("button", { name: /Add responsibility/i }).click();
    await openResponsibilitySection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill("Bathroom");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await openResponsibilitySection(page, "When");
    await page.getByRole("button", { name: "Every day" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await openResponsibilitySection(page, "Who");
    await chooseAssignmentMode(page, "Fixed person");
    await page.getByRole("button", { name: /Choose accountable person/i }).click();
    await pickAccountablePerson(page, "Jordan");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await fillResponsibilityBaseSteps(page, ["Sink", "Mirror", "Toilet", "Floor"]);
    await addScheduledWorkAddition(page, {
      name: "Sunday extra",
      weekdays: [7],
      inheritAssignment: true,
      stepTexts: ["Towels", "Trash", "Supplies", "Grout", "Vent"],
    });
    await page.getByRole("button", { name: "Create responsibility", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByRole("heading", { name: "Bathroom" })).toBeVisible({ timeout: 20_000 });
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "02-bathroom-detail.png"));
    }

    await page.reload();
    const bathroomId = page.url().split("/").pop()!;
    const sunday = isoWeekday(today) === 7 ? today : nextWeekday(today, 7);
    const sunMixed = await page.request.get(`/api/v1/today?date=${sunday}`);
    const bathroomSun = (
      (await sunMixed.json()) as {
        occurrences: Array<{
          definitionId: string;
          accountableMemberId: string | null;
          steps: Array<{ text: string; additionHeading?: string | null }>;
        }>;
      }
    ).occurrences.find((o) => o.definitionId === bathroomId);
    expect(bathroomSun).toBeTruthy();
    expect(bathroomSun!.accountableMemberId).toBe(JORDAN_ID);
    expect(bathroomSun!.steps.length).toBe(9);

    const monday = previousOrSameWeekday(today, 1);
    if (isoWeekday(monday) !== 7) {
      const monMixed = await page.request.get(`/api/v1/today?date=${monday}`);
      const bathroomMon = (
        (await monMixed.json()) as {
          occurrences: Array<{ definitionId: string; steps: Array<{ text: string }> }>;
        }
      ).occurrences.find((o) => o.definitionId === bathroomId);
      if (bathroomMon) expect(bathroomMon.steps.length).toBe(4);
    }

    void PASSPHRASE;
    void mutatingHeaders;
  });
});
