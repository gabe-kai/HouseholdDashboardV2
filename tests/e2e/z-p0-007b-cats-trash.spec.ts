import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  addTurnOrderPeople,
  chooseAssignmentMode,
  confirmResponsibilitySaveIfNeeded,
  ensureManagerSession,
  expectSignedInAs,
  fillFocusedResponsibilityCreate,
  openResponsibilitySection,
  sessionDisplayName,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const AVERY_LOGIN = "e2e.avery";
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

function nextOrSameWeekday(from: string, weekday: number): string {
  let candidate = from;
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

async function openAsManager(page: Page) {
  await ensureManagerSession(page);
  await page.goto("/");
  const name = await sessionDisplayName(page);
  await expectSignedInAs(page, name || /Morgan/);
}

test.describe("P0-007B Cats and Trash journeys", () => {
  test("AT6: Cats take turns and fixed Tuesday Trash", async ({ page, browser }, testInfo) => {
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

    await fillFocusedResponsibilityCreate(page, {
      title: "Cats",
      weekdaysPreset: "every",
      daypart: "anytime",
      ownerName: "Avery",
      stepTexts: ["Feed cats", "Refresh water"],
    });
    await expect(page.getByRole("heading", { name: "Cats" })).toBeVisible({ timeout: 20_000 });
    const catsId = page.url().split("/").pop()!;

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openResponsibilitySection(page, "Who");
    await chooseAssignmentMode(page, "Take turns");
    await addTurnOrderPeople(page, ["Avery", "Casey", "Jordan"]);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(page);
    await expect(page.getByText(/Avery.*Casey.*Jordan|Casey/i).first()).toBeVisible({
      timeout: 20_000,
    });
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "03-cats-turns.png"));
    }

    await page.getByRole("button", { name: /Back to Plan/i }).click();
    await fillFocusedResponsibilityCreate(page, {
      title: "Trash & Recycling",
      weekdaysPreset: "tuesday",
      daypart: "evening",
      ownerName: "Avery",
      stepTexts: ["Take out trash", "Set recycling"],
    });
    await expect(page.getByRole("heading", { name: "Trash & Recycling" })).toBeVisible({
      timeout: 20_000,
    });
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "04-trash-fixed.png"));
    }

    const session = await page.request.get("/api/v1/auth/session");
    const today = ((await session.json()) as { householdDate: string }).householdDate;
    const tuesday = nextOrSameWeekday(today, 2);

    const catsPreview = await page.request.get(`/api/v1/responsibilities/${catsId}/preview`);
    expect(catsPreview.ok()).toBeTruthy();
    const previewBody = (await catsPreview.json()) as {
      preview: Array<{ householdDate: string; accountableMemberName: string | null }>;
    };
    const owners = previewBody.preview
      .filter((row) => row.accountableMemberName)
      .map((row) => row.accountableMemberName!);
    expect(new Set(owners).size).toBeGreaterThan(1);

    const trashDefinitionId = page.url().split("/").pop()!;
    expect(trashDefinitionId).toBeTruthy();

    const mixedTuesday = await page.request.get(`/api/v1/today?date=${tuesday}`);
    expect(mixedTuesday.ok()).toBeTruthy();
    const trashOcc = (
      (await mixedTuesday.json()) as {
        occurrences: Array<{
          id: string;
          definitionId: string;
          accountableMemberId: string | null;
          kind: string;
        }>;
      }
    ).occurrences.find((o) => o.definitionId === trashDefinitionId);
    expect(trashOcc).toBeTruthy();
    expect(trashOcc!.accountableMemberId).toBe(AVERY_ID);
    expect(trashOcc!.kind).toBe("responsibility");

    const catsOcc = (
      (await mixedTuesday.json()) as {
        occurrences: Array<{ definitionId: string; accountableMemberId: string | null }>;
      }
    ).occurrences.find((o) => o.definitionId === catsId);
    expect(catsOcc?.accountableMemberId).toMatch(
      new RegExp(`${AVERY_ID}|${CASEY_ID}|${JORDAN_ID}`),
    );

    const averyContext = await browser.newContext();
    const averyPage = await averyContext.newPage();
    await claimPerson(averyPage, AVERY_ID, AVERY_LOGIN, "Avery Reed");
    await averyPage.goto("/");
    if (trashOcc && isoWeekday(today) === 2) {
      const trashCard = averyPage
        .locator(".occurrence")
        .filter({ hasText: /^Trash\b|Trash$/ })
        .filter({ has: averyPage.getByRole("button", { name: /Mark .+ completed/i }) })
        .first();
      await expect(trashCard).toBeVisible({ timeout: 20_000 });
    }
    if (capture) {
      await durableScreenshot(averyPage, path.join(SCREENSHOT_DIR, "05-today-cats-trash.png"));
    }
    await averyContext.close();
  });
});
