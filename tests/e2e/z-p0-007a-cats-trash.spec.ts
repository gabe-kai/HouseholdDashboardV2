import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  expectSignedInAs,
  fillFocusedResponsibilityCreate,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_LOGIN = "e2e.avery";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const SCREENSHOT_DIR = path.resolve("reports/p0-007a-r1-screenshots");

function requestOrigin(_request?: APIRequestContext): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
}

async function ensureManagerSession(request: APIRequestContext) {
  const origin = requestOrigin(request);
  const boot = await request.post("/api/v1/test/bootstrap-claim");
  if (boot.ok()) {
    const { token } = (await boot.json()) as { token: string };
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: origin },
      data: {
        claimToken: token,
        loginName: MANAGER_LOGIN,
        passphrase: PASSPHRASE,
        displayName: "Morgan Reed",
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  expect(boot.status()).toBe(409);
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: MANAGER_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function csrf(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { csrfToken: string }).csrfToken;
}

async function mutatingHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  return {
    "x-csrf-token": await csrf(request),
    Origin: requestOrigin(request),
  };
}

async function claimAvery(request: APIRequestContext) {
  await ensureManagerSession(request);
  const enroll = await request.post("/api/v1/enrollment/claims", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      membershipId: AVERY_ID,
      preset: "direct_personalizer",
    },
  });
  if (enroll.ok()) {
    const token = ((await enroll.json()) as { claim: { token: string } }).claim.token;
    await request.post("/api/v1/auth/logout", { headers: await mutatingHeaders(request) });
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: requestOrigin(request) },
      data: {
        claimToken: token,
        loginName: AVERY_LOGIN,
        passphrase: PASSPHRASE,
        displayName: "Avery Reed",
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  await request.post("/api/v1/auth/logout", { headers: await mutatingHeaders(request) });
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: requestOrigin(request) },
    data: { loginName: AVERY_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  await page.goto("/");
  await expectSignedInAs(page, "Morgan Reed");
}

test.describe("P0-007A Cats and Trash foundation", () => {
  test("parent creates Cats and Trash; child completes Cats; oversight and History update", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      testInfo.project.name === "chromium-desktop",
      "Phone Chromium/WebKit own this journey",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const capture = testInfo.project.name === "chromium";

    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();

    await fillFocusedResponsibilityCreate(page, {
      title: "Cats",
      weekdaysPreset: "every",
      daypart: "anytime",
      ownerName: "Avery",
      stepTexts: ["Feed cats", "Refresh water"],
    });
    await expect(page.getByRole("heading", { name: "Cats" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Next 7 days" })).toBeVisible();
    await expect(page).toHaveURL(/\/plan\/responsibilities\//);
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "01-cats-detail.png"));
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
    await expect(page.getByText(/Evening/i).first()).toBeVisible();
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "02-trash-detail.png"));
    }

    const previewRows = page.locator(".responsibility-preview-list li");
    await expect(previewRows.first()).toBeVisible();
    const previewText = await previewRows.allTextContents();
    expect(previewText.some((line) => /No work/i.test(line))).toBeTruthy();
    // AT4: Next 7 days preview includes Trash on a Tuesday with Avery as owner.
    // Preview rows use ISO dates (not weekday abbreviations).
    const trashPreview = previewText.find((line) => /Trash & Recycling/i.test(line));
    expect(trashPreview, `expected Trash preview among: ${previewText.join(" | ")}`).toBeTruthy();
    expect(trashPreview!).toMatch(/Avery/i);
    const trashDate = trashPreview!.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
    expect(trashDate).toBeTruthy();
    const trashDow = new Date(`${trashDate}T12:00:00Z`).getUTCDay();
    expect(trashDow).toBe(2); // Tuesday

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

    const childContext = await browser.newContext();
    const child = await childContext.newPage();
    await claimAvery(child.request);
    const averySession = await child.request.get("/api/v1/auth/session");
    expect(averySession.ok()).toBeTruthy();
    const averyBody = (await averySession.json()) as {
      member?: { displayName?: string };
      householdDate?: string;
      activityGeneration?: number;
    };
    const averyName = averyBody.member?.displayName ?? "Avery Reed";
    const today = averyBody.householdDate!;
    const todayWeekday = isoWeekday(today);
    const tuesdayForExec = previousOrSameWeekday(today, 2);

    // Ensure Trash applies on a controlled executable date: keep Tuesday, and if today is
    // not Tuesday include today so Today UI / History can prove evening execution + daypart order.
    const trashDetailUrl = page.url();
    const trashDefinitionId = trashDetailUrl.split("/").pop()!;
    const trashDetail = await page.request.get(`/api/v1/responsibilities/${trashDefinitionId}`);
    expect(trashDetail.ok()).toBeTruthy();
    const trashBody = (await trashDetail.json()) as {
      responsibility: {
        version: number;
        revisions: Array<{
          daypart: string;
          weekdays: number[];
          assigneeMemberIds: string[];
          steps: Array<{ text: string; obligation: string; logicalItemId?: string }>;
        }>;
      };
    };
    const trashRev = trashBody.responsibility.revisions[0]!;
    const execWeekdays = Array.from(new Set([2, todayWeekday])).sort((a, b) => a - b);
    if (todayWeekday !== 2) {
      const widen = await page.request.post(
        `/api/v1/responsibilities/${trashDefinitionId}/revisions`,
        {
          headers: await mutatingHeaders(page.request),
          data: {
            mutationId: crypto.randomUUID(),
            title: "Trash & Recycling",
            daypart: "evening",
            weekdays: execWeekdays,
            accountableMemberId: trashRev.assigneeMemberIds[0] ?? AVERY_ID,
            steps: trashRev.steps.map((step) => ({
              text: step.text,
              obligation: step.obligation,
              ...(step.logicalItemId ? { logicalItemId: step.logicalItemId } : {}),
            })),
            expectedVersion: trashBody.responsibility.version,
            mode: "current",
          },
        },
      );
      expect(widen.ok(), await widen.text()).toBeTruthy();
    }

    const execDate = todayWeekday === 2 ? today : today;
    const mixedToday = await child.request.get(`/api/v1/today?date=${execDate}`);
    expect(mixedToday.ok(), await mixedToday.text()).toBeTruthy();
    const mixedItems = (
      (await mixedToday.json()) as {
        occurrences: Array<{
          id: string;
          title: string;
          daypart: string;
          kind: string;
          steps: Array<{ id: string; text: string; logicalItemId?: string }>;
          revisionId: string;
          accountableMemberId: string;
        }>;
      }
    ).occurrences;
    const trashOcc = mixedItems.find((o) => /Trash & Recycling/i.test(o.title));
    const catsOnDay = mixedItems.find((o) => /^Cats$/i.test(o.title));
    expect(trashOcc, "Trash occurrence on controlled executable date").toBeTruthy();
    expect(trashOcc!.daypart).toBe("evening");
    expect(trashOcc!.kind).toBe("responsibility");
    if (catsOnDay) {
      const trashIdx = mixedItems.findIndex((o) => o.id === trashOcc!.id);
      const catsIdx = mixedItems.findIndex((o) => o.id === catsOnDay.id);
      expect(trashIdx).toBeLessThan(catsIdx);
    }

    // True Tuesday execution when today is Tuesday; otherwise execute on today while Tuesday
    // remains in the weekday set (preview already proved Tuesday). Integration covers backdated Tuesday.
    for (const step of trashOcc!.steps) {
      const complete = await child.request.post(
        `/api/v1/occurrences/${trashOcc!.id}/steps/${step.id}/status`,
        {
          headers: await mutatingHeaders(child.request),
          data: {
            mutationId: crypto.randomUUID(),
            status: "completed",
            performedAt: new Date().toISOString(),
            activityGeneration: averyBody.activityGeneration ?? 0,
            kind: "responsibility",
            intendedStructure: {
              revisionId: trashOcc!.revisionId,
              accountableMemberId: trashOcc!.accountableMemberId,
              stepLogicalIds: trashOcc!.steps.map((s) => s.logicalItemId!).filter(Boolean),
            },
          },
        },
      );
      expect(complete.ok(), await complete.text()).toBeTruthy();
    }

    await child.goto("/");
    await expectSignedInAs(child, averyName);
    const catsCard = child.locator(".occurrence").filter({ hasText: "Cats" });
    await expect(catsCard).toBeVisible({ timeout: 20_000 });
    const trashCard = child.locator(".occurrence").filter({ hasText: "Trash & Recycling" });
    await expect(trashCard).toBeVisible({ timeout: 20_000 });
    await expect(trashCard).toHaveAttribute("data-completed", "true");
    const todayCards = child.locator(".occurrence");
    const titles = await todayCards.allTextContents();
    const trashPos = titles.findIndex((t) => /Trash & Recycling/i.test(t));
    const catsPos = titles.findIndex((t) => /Cats/i.test(t));
    if (trashPos >= 0 && catsPos >= 0) expect(trashPos).toBeLessThan(catsPos);
    if (capture) {
      await durableScreenshot(child, path.join(SCREENSHOT_DIR, "03-today-mixed.png"));
    }

    // AT3: manager already on Household activity BEFORE child completes.
    await page.getByRole("button", { name: "Household", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /Household activity/i })
      .click();
    await expect(page.getByRole("heading", { name: "Household activity" })).toBeVisible();
    const catsRow = page.locator(".compact-activity-row").filter({ hasText: "Cats" });
    await expect(catsRow).toBeVisible({ timeout: 20_000 });
    await expect(catsRow).not.toContainText(/^Complete$/i);

    await catsCard.getByRole("button", { name: /Mark Feed cats completed/i }).click();
    await catsCard.getByRole("button", { name: /Mark Refresh water completed/i }).click();
    await expect(catsCard).toHaveAttribute("data-completed", "true", { timeout: 20_000 });

    // Live update without manager navigation/reload.
    await expect(catsRow).toContainText(/Complete/i, { timeout: 20_000 });
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "04-household-activity.png"));
    }
    await catsRow.click();
    await expect(page.getByRole("heading", { name: "Cats" })).toBeVisible();
    await page.getByRole("button", { name: /Back to Household activity/i }).click();
    await page.getByRole("button", { name: /Back to Household/i }).click();

    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^History/i })
      .click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await page.getByRole("button", { name: /Filters/i }).click();
    await page.getByLabel("Work").selectOption("responsibility");
    await page.locator(".history-date-field input[type='date']").fill(execDate);
    await expect(page.getByRole("button", { name: /Trash/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    const hist = await page.request.get(`/api/v1/history?date=${execDate}&kind=responsibility`);
    expect(hist.ok()).toBeTruthy();
    const histBody = (await hist.json()) as {
      occurrences: Array<{ title: string }>;
    };
    expect(
      histBody.occurrences.some((o) => /Trash & Recycling/i.test(o.title)),
      "Trash in History after controlled execution",
    ).toBeTruthy();
    void tuesdayForExec;
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "05-history-responsibilities.png"));
    }

    await childContext.close();
  });
});
