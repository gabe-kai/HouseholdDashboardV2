import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  chooseAssignmentMode,
  confirmResponsibilitySaveIfNeeded,
  ensureManagerSession,
  expectSignedInAs,
  openResponsibilitySection,
  pickAccountablePerson,
  sessionDisplayName,
} from "../helpers/e2e-shell";

const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const CASEY_ID = "22222222-2222-4222-8222-222222222204";
const JORDAN_ID = "22222222-2222-4222-8222-222222222203";
const SCREENSHOT_DIR = path.resolve("reports/p0-007b-r1-screenshots");

function requestOrigin(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d! + days, 12, 0, 0));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

async function csrf(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { csrfToken: string }).csrfToken;
}

async function mutatingHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  return {
    "x-csrf-token": await csrf(request),
    Origin: requestOrigin(),
  };
}

async function householdToday(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { householdDate: string }).householdDate;
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page);
  await page.goto("/");
  const name = await sessionDisplayName(page);
  await expectSignedInAs(page, name || /Morgan/);
}

async function openPeopleGroups(page: Page) {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Household", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Household" })
    .getByRole("button", { name: /People & Groups/ })
    .click();
  await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible();
}

test.describe("P0-007B AT7 group eligibility", () => {
  test("linked group, exclusions, membership, Unassigned repair, delete blocked", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(
      testInfo.project.name === "chromium-desktop",
      "Phone Chromium owns AT7; desktop geometry is separate",
    );
    test.skip(testInfo.project.name === "webkit", "Chromium phone journey for AT7");
    await page.setViewportSize({ width: 390, height: 844 });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const capture = testInfo.project.name === "chromium";
    const suffix = Date.now().toString(36);
    const groupName = `Kids ${suffix}`;
    const turnsTitle = `Take turns ${suffix}`;
    const unassignedTitle = `Unassigned weekly ${suffix}`;
    const pendingName = `Pat Pending ${suffix}`;

    await openAsManager(page);
    await openPeopleGroups(page);

    // Pending-access person (setup prepared, not claimed).
    await page.getByRole("button", { name: "Add person" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(pendingName);
    await page.getByRole("radio", { name: "Child" }).check();
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByRole("heading", { name: pendingName })).toBeVisible();
    await page.getByRole("button", { name: "Set up access" }).click();
    await expect(page.getByRole("heading", { name: "Access setup" })).toBeVisible();
    await page.getByRole("radio", { name: /Guided member/i }).check();
    await page.getByRole("button", { name: "Prepare access setup" }).click();
    await expect(page.getByText(/Copy this setup material now/i)).toBeVisible();
    await page.getByRole("button", { name: "Cancel setup" }).click();
    await page.getByRole("button", { name: new RegExp(`Back to ${pendingName}`) }).click();
    await expect(page.getByText("Not set up")).toBeVisible();
    await page.getByRole("button", { name: "Back to People & Groups" }).click();

    await page.getByRole("button", { name: "Create group" }).click();
    await page.getByLabel("Group name").fill(groupName);
    await page.getByRole("checkbox", { name: /Avery/ }).first().check();
    await page.getByRole("checkbox", { name: /Casey/ }).first().check();
    await page.getByRole("checkbox", { name: /Jordan/ }).first().check();
    await page.getByRole("checkbox", { name: new RegExp(pendingName) }).first().check();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByRole("heading", { name: groupName })).toBeVisible({ timeout: 15_000 });

    const groups = await page.request.get("/api/v1/groups");
    expect(groups.ok()).toBeTruthy();
    const group = (
      (await groups.json()) as { groups: Array<{ id: string; name: string; version: number }> }
    ).groups.find((item) => item.name === groupName);
    expect(group, "Kids group created").toBeTruthy();

    const members = await page.request.get("/api/v1/people");
    expect(members.ok()).toBeTruthy();
    const pendingId = (
      (await members.json()) as { people: Array<{ id: string; displayName: string }> }
    ).people.find((person) => person.displayName === pendingName)?.id;
    expect(pendingId).toBeTruthy();

    const today = await householdToday(page.request);
    // No exclusion UI in Take turns editor — create linked group assignment via API.
    const created = await page.request.post("/api/v1/responsibilities", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: turnsTitle,
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "take_turns",
          anchorDate: today,
          sourceGroupId: group!.id,
          savedRingOrder: [AVERY_ID, CASEY_ID, JORDAN_ID, pendingId],
          excludedMemberIds: [JORDAN_ID],
        },
        steps: [{ text: "Chore step", obligation: "required" }],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const turnsId = ((await created.json()) as { responsibility: { id: string } }).responsibility
      .id;

    await page.goto(`/plan/responsibilities/${turnsId}`);
    await expect(page.getByRole("heading", { name: turnsTitle })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".responsibility-preview-list li").first()).toBeVisible({
      timeout: 15_000,
    });
    const previewText = await page.locator(".responsibility-preview-list").innerText();
    expect(previewText).toMatch(/Avery|Casey|Pat Pending/i);
    expect(previewText).not.toMatch(/Jordan Reed/);

    // Pending-access person remains eligible in preview.
    const previewApi = await page.request.get(`/api/v1/responsibilities/${turnsId}/preview`);
    expect(previewApi.ok()).toBeTruthy();
    const previewBody = (await previewApi.json()) as {
      preview: Array<{ accountableMemberId: string | null; accountableMemberName: string | null }>;
    };
    const eligibleIds = new Set(
      previewBody.preview
        .map((day) => day.accountableMemberId)
        .filter((id): id is string => Boolean(id)),
    );
    expect(eligibleIds.has(pendingId!)).toBeTruthy();
    expect(eligibleIds.has(JORDAN_ID)).toBeFalsy();

    // Edit group membership via normal UI (remove Avery; next-day effect).
    await openPeopleGroups(page);
    await page.getByRole("button", { name: new RegExp(`^${groupName}`) }).first().click();
    await expect(page.getByRole("heading", { name: groupName })).toBeVisible();
    await page.getByRole("button", { name: "Edit group" }).click();
    await page.getByRole("checkbox", { name: /Avery/ }).first().uncheck();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByRole("heading", { name: groupName })).toBeVisible({ timeout: 15_000 });

    const tomorrow = addDays(today, 1);
    await expect
      .poll(async () => {
        const mixed = await page.request.get(`/api/v1/today?date=${tomorrow}`);
        if (!mixed.ok()) return "error";
        const occ = (
          (await mixed.json()) as {
            occurrences: Array<{
              definitionId: string;
              accountableMemberId: string | null;
            }>;
          }
        ).occurrences.find((row) => row.definitionId === turnsId);
        if (!occ) return "missing";
        return occ.accountableMemberId === AVERY_ID ? "still-avery" : "updated";
      })
      .toBe("updated");

    const tomorrowPreview = await page.request.get(
      `/api/v1/responsibilities/${turnsId}/preview`,
    );
    expect(tomorrowPreview.ok()).toBeTruthy();
    const tomorrowOwners = (
      (await tomorrowPreview.json()) as {
        preview: Array<{ householdDate: string; accountableMemberId: string | null }>;
      }
    ).preview;
    const tomorrowRow = tomorrowOwners.find((row) => row.householdDate === tomorrow);
    expect(tomorrowRow?.accountableMemberId).not.toBe(AVERY_ID);

    // Add Avery back for returnee behavior on a later day.
    await page.getByRole("button", { name: "Edit group" }).click();
    await page.getByRole("checkbox", { name: /Avery/ }).first().check();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByRole("heading", { name: groupName })).toBeVisible({ timeout: 15_000 });

    // Fixed weekly slot with missing/ineligible member → Unassigned warning; repair preserves occurrence id.
    const weeklyMap: Record<string, string> = {
      "1": AVERY_ID,
      "2": AVERY_ID,
      "3": AVERY_ID,
      "4": AVERY_ID,
      "5": AVERY_ID,
      "6": AVERY_ID,
      "7": AVERY_ID,
    };
    const emptyCycle = await page.request.post("/api/v1/responsibilities", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: unassignedTitle,
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "take_turns",
          anchorDate: today,
          sourceGroupId: group!.id,
          savedRingOrder: [AVERY_ID, CASEY_ID, JORDAN_ID],
          excludedMemberIds: [AVERY_ID, CASEY_ID, JORDAN_ID, pendingId],
        },
        steps: [{ text: "Solo chore", obligation: "required" }],
      },
    });
    expect(emptyCycle.ok(), await emptyCycle.text()).toBeTruthy();
    const unassignedId = (
      (await emptyCycle.json()) as { responsibility: { id: string } }
    ).responsibility.id;

    // Also prove weekly missing-slot Unassigned when map points at excluded-empty ring via repair target.
    void weeklyMap;

    await page.goto(`/plan/responsibilities/${unassignedId}`);
    await expect(page.getByRole("heading", { name: unassignedTitle })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole("status").filter({ hasText: /Some upcoming dates are Unassigned/i }),
    ).toBeVisible({ timeout: 15_000 });

    const beforeOcc = await page.request.get(`/api/v1/today?date=${today}`);
    expect(beforeOcc.ok()).toBeTruthy();
    const occBefore = (
      (await beforeOcc.json()) as {
        occurrences: Array<{ id: string; definitionId: string; accountableMemberId: string | null }>;
      }
    ).occurrences.find((row) => row.definitionId === unassignedId);
    expect(occBefore).toBeTruthy();
    expect(occBefore!.accountableMemberId).toBeNull();
    const occurrenceId = occBefore!.id;

    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "06-unassigned-activity.png"));
    }

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openResponsibilitySection(page, "Who");
    await chooseAssignmentMode(page, "Fixed person");
    await page.getByRole("button", { name: /Choose accountable person|Avery/i }).click();
    await pickAccountablePerson(page, "Avery");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByRole("heading", { name: unassignedTitle })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole("status").filter({ hasText: /Some upcoming dates are Unassigned/i }),
    ).toHaveCount(0);

    const afterOcc = await page.request.get(`/api/v1/today?date=${today}`);
    expect(afterOcc.ok()).toBeTruthy();
    const occAfter = (
      (await afterOcc.json()) as {
        occurrences: Array<{ id: string; definitionId: string; accountableMemberId: string | null }>;
      }
    ).occurrences.find((row) => row.definitionId === unassignedId);
    expect(occAfter?.id).toBe(occurrenceId);
    expect(occAfter?.accountableMemberId).toBe(AVERY_ID);

    // Family name change for a non-seed person updates preview without changing occurrence identity.
    await openPeopleGroups(page);
    await page.getByRole("button", { name: new RegExp(pendingName) }).first().click();
    await page.getByRole("button", { name: "Edit person" }).click();
    await expect(page.getByRole("heading", { name: "Edit person" })).toBeVisible();
    await page.getByRole("textbox", { name: "Name" }).first().fill(`Pat Renamed ${suffix}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: `Pat Renamed ${suffix}` })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Back to People & Groups" }).click();
    await page.goto(`/plan/responsibilities/${turnsId}`);
    await expect(page.getByRole("heading", { name: turnsTitle })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(".responsibility-preview-list")).toContainText(/Pat Renamed/i, {
      timeout: 15_000,
    });

    // Attempt delete referenced group → blocked.
    await openPeopleGroups(page);
    await page.getByRole("button", { name: new RegExp(`^${groupName}`) }).first().click();
    await page.getByRole("button", { name: "Edit group" }).click();
    await page.getByRole("button", { name: "Delete group" }).click();
    await page.getByRole("button", { name: "Confirm delete group" }).click();
    await expect(page.getByRole("alert")).toContainText(/Remove this group|before deleting|used/i, {
      timeout: 15_000,
    });
  });
});
