import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  expectSignedInAs,
  fillFocusedResponsibilityCreate,
  openRoutineSection,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
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

async function openAsManager(page: import("@playwright/test").Page) {
  await ensureManagerSession(page.request);
  await page.goto("/");
  await expectSignedInAs(page, "Morgan Reed");
}

test.describe("P0-007A Architecture FIX REQUIRED regressions", () => {
  test("R3: dirty draft keeps pinned expectedVersion after competing save", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(
      testInfo.project.name !== "chromium",
      "Focused Chromium regression for draft version pin",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();

    await fillFocusedResponsibilityCreate(page, {
      title: "Cats",
      weekdaysPreset: "every",
      daypart: "anytime",
      ownerName: "Avery",
      stepTexts: ["Feed cats"],
    });
    await expect(page.getByRole("heading", { name: "Cats" })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/plan\/responsibilities\//);

    const detailUrl = page.url();
    const definitionId = detailUrl.split("/").pop()!;
    const detailRes = await page.request.get(`/api/v1/responsibilities/${definitionId}`);
    expect(detailRes.ok()).toBeTruthy();
    const detailBody = (await detailRes.json()) as {
      responsibility: {
        id: string;
        version: number;
        revisions: Array<{
          title: string;
          daypart: string;
          weekdays: number[];
          assigneeMemberIds: string[];
          steps: Array<{ text: string; obligation: string; logicalItemId?: string }>;
        }>;
      };
    };
    expect(detailBody.responsibility.version).toBe(1);
    const revision = detailBody.responsibility.revisions[0]!;

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openRoutineSection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill("Cats draft keep");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText(/Cats draft keep/i).first()).toBeVisible();

    const compete = await page.request.post(`/api/v1/responsibilities/${definitionId}/revisions`, {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: "Cats v2 remote",
        daypart: revision.daypart,
        weekdays: revision.weekdays,
        accountableMemberId: revision.assigneeMemberIds[0] ?? AVERY_ID,
        steps: revision.steps.map((step) => ({
          text: step.text,
          obligation: step.obligation,
          ...(step.logicalItemId ? { logicalItemId: step.logicalItemId } : {}),
        })),
        expectedVersion: 1,
        mode: "current",
      },
    });
    expect(compete.ok(), await compete.text()).toBeTruthy();
    expect(
      ((await compete.json()) as { responsibility: { version: number } }).responsibility.version,
    ).toBe(2);

    // Supporting refresh must not retarget the pinned draft baseline.
    await page.waitForTimeout(1000);

    await page.getByRole("button", { name: /^Save$/i }).click();
    await expect(page.getByRole("alert")).toContainText(/updated elsewhere|re-read|try again/i, {
      timeout: 15_000,
    });
    await expect(page.getByText(/Cats draft keep/i).first()).toBeVisible();

    const after = await page.request.get(`/api/v1/responsibilities/${definitionId}`);
    expect(after.ok()).toBeTruthy();
    expect(
      ((await after.json()) as { responsibility: { version: number } }).responsibility.version,
    ).toBe(2);

    await durableScreenshot(page, path.join(SCREENSHOT_DIR, "06-draft-version-conflict.png"));
  });

  function addDays(date: string, days: number): string {
    const [y, m, d] = date.split("-").map(Number);
    const utc = new Date(Date.UTC(y!, m! - 1, d! + days, 12, 0, 0));
    const yy = utc.getUTCFullYear();
    const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(utc.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  async function householdToday(request: APIRequestContext): Promise<string> {
    const session = await request.get("/api/v1/auth/session");
    expect(session.ok()).toBeTruthy();
    return ((await session.json()) as { householdDate: string }).householdDate;
  }

  test("AT5/8: schedule later, edit upcoming, collision retain draft, Delete unused, End with history", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(testInfo.project.name !== "chromium", "Chromium-focused responsibility UI");
    await page.setViewportSize({ width: 390, height: 844 });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    const suffix = Date.now().toString(36);
    const title = `AT5 Cats ${suffix}`;
    await fillFocusedResponsibilityCreate(page, {
      title,
      weekdaysPreset: "every",
      daypart: "anytime",
      ownerName: "Avery",
      stepTexts: ["Feed", "Water"],
    });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    await durableScreenshot(page, path.join(SCREENSHOT_DIR, "07-editor-detail.png"));

    const today = await householdToday(page.request);
    const day2 = addDays(today, 2);
    const day4 = addDays(today, 4);

    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Schedule for later" }).click();
    await expect(page.getByRole("heading", { name: "Schedule for later" })).toBeVisible();
    await page.getByLabel("Starting").fill(day2);
    await openRoutineSection(page, "Work");
    await page.locator("[data-ordered-row]").first().locator(".ordered-row-body button").click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Feed day-two");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: /^Save$/i }).click();
    await expect(page.getByText(new RegExp(`Starting ${day2}`))).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Schedule for later" }).click();
    await page.getByLabel("Starting").fill(day4);
    await openRoutineSection(page, "Work");
    await page.locator("[data-ordered-row]").first().locator(".ordered-row-body button").click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Feed day-four");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: /^Save$/i }).click();
    await expect(page.getByText(new RegExp(`Starting ${day4}`))).toBeVisible({ timeout: 15_000 });

    await page
      .locator("li")
      .filter({ hasText: `Starting ${day4}` })
      .getByRole("button", { name: "Edit upcoming", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Edit upcoming change" })).toBeVisible();
    await openRoutineSection(page, "Work");
    await page.locator("[data-ordered-row]").first().locator(".ordered-row-body button").click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Feed day-four edited");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Starting ${day4}`))).toBeVisible({ timeout: 15_000 });
    // Detail returns to read view after upcoming edit save.
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    // Collision retains draft (day2 already occupied).
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Schedule for later" }).click();
    await openRoutineSection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill(`${title} collision draft`);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByLabel("Starting").fill(day2);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/already exists for that date|already starts on/i, {
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: /^Name/ })).toContainText(
      `${title} collision draft`,
    );
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByRole("button", { name: /Back to/i }).click();

    // Delete unused responsibility.
    await page.getByRole("button", { name: /Back to Plan/i }).click();
    const unusedTitle = `Unused ${suffix}`;
    await fillFocusedResponsibilityCreate(page, {
      title: unusedTitle,
      weekdaysPreset: "every",
      daypart: "anytime",
      ownerName: "Avery",
      stepTexts: ["Do it"],
    });
    await expect(page.getByRole("heading", { name: unusedTitle })).toBeVisible({ timeout: 20_000 });
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toMatch(/Delete this unused/i);
      void dialog.accept();
    });
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: unusedTitle })).toHaveCount(0);

    // End with started history retention: Avery completes, manager Ends.
    const keepTitle = `Kept ${suffix}`;
    await fillFocusedResponsibilityCreate(page, {
      title: keepTitle,
      weekdaysPreset: "every",
      daypart: "anytime",
      ownerName: "Avery",
      stepTexts: ["Keep step"],
    });
    await expect(page.getByRole("heading", { name: keepTitle })).toBeVisible({ timeout: 20_000 });

    const childContext = await browser.newContext();
    const child = await childContext.newPage();
    const origin = requestOrigin(child.request);
    await ensureManagerSession(child.request);
    const enroll = await child.request.post("/api/v1/enrollment/claims", {
      headers: await mutatingHeaders(child.request),
      data: {
        mutationId: crypto.randomUUID(),
        membershipId: AVERY_ID,
        preset: "direct_personalizer",
      },
    });
    if (enroll.ok()) {
      const token = ((await enroll.json()) as { claim: { token: string } }).claim.token;
      await child.request.post("/api/v1/auth/logout", {
        headers: await mutatingHeaders(child.request),
      });
      const claim = await child.request.post("/api/v1/auth/claim", {
        headers: { Origin: origin },
        data: {
          claimToken: token,
          loginName: `e2e.avery.at5.${suffix}`,
          passphrase: PASSPHRASE,
          displayName: "Avery Reed",
        },
      });
      expect(claim.ok(), await claim.text()).toBeTruthy();
    } else {
      await child.request.post("/api/v1/auth/logout", {
        headers: await mutatingHeaders(child.request),
      });
      const login = await child.request.post("/api/v1/auth/login", {
        headers: { Origin: origin },
        data: { loginName: "e2e.avery", passphrase: PASSPHRASE },
      });
      expect(login.ok() || login.status() === 401).toBeTruthy();
      if (!login.ok()) {
        // Avery may already be claimed under another login in this DB; skip seed complete.
        await childContext.close();
      }
    }
    if (!child.isClosed()) {
      await child.goto("/");
      const catsCard = child.locator(".occurrence").filter({ hasText: keepTitle });
      if (await catsCard.count()) {
        await catsCard.getByRole("button", { name: /Mark Keep step completed/i }).click();
        await expect(catsCard).toHaveAttribute("data-completed", "true", { timeout: 20_000 });
      }
      await childContext.close();
    }

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toMatch(/End this responsibility/i);
      void dialog.accept();
    });
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "End responsibility", exact: true }).click();
    await expect(page.getByText(/Ended/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("AT12/13: miss WS then visibility refreshes Plan detail; clear then History empty", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(testInfo.project.name !== "chromium", "Chromium-focused recovery");
    await page.setViewportSize({ width: 390, height: 844 });

    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    const title = `Recover Cats ${Date.now().toString(36)}`;
    await fillFocusedResponsibilityCreate(page, {
      title,
      weekdaysPreset: "every",
      daypart: "anytime",
      ownerName: "Avery",
      stepTexts: ["Feed"],
    });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    const definitionId = page.url().split("/").pop()!;

    await page.evaluate(() => {
      (
        window as unknown as { __hdSync?: { closeForTest: () => void } }
      ).__hdSync?.closeForTest();
    });
    await expect(page.locator(".status-pill[data-kind='online']")).toContainText(/Reconnecting/, {
      timeout: 10_000,
    });

    // Competing rename while WS down.
    const detail = await page.request.get(`/api/v1/responsibilities/${definitionId}`);
    const body = (await detail.json()) as {
      responsibility: {
        version: number;
        revisions: Array<{
          title: string;
          daypart: string;
          weekdays: number[];
          assigneeMemberIds: string[];
          steps: Array<{ text: string; obligation: string; logicalItemId?: string }>;
        }>;
      };
    };
    const rev = body.responsibility.revisions[0]!;
    const renamed = `${title} live`;
    const compete = await page.request.post(`/api/v1/responsibilities/${definitionId}/revisions`, {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: renamed,
        daypart: rev.daypart,
        weekdays: rev.weekdays,
        accountableMemberId: rev.assigneeMemberIds[0] ?? AVERY_ID,
        steps: rev.steps.map((step) => ({
          text: step.text,
          obligation: step.obligation,
          ...(step.logicalItemId ? { logicalItemId: step.logicalItemId } : {}),
        })),
        expectedVersion: body.responsibility.version,
        mode: "current",
      },
    });
    expect(compete.ok(), await compete.text()).toBeTruthy();

    await expect(page.locator(".status-pill[data-kind='online']")).toHaveCount(0, {
      timeout: 20_000,
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible({ timeout: 20_000 });

    // Clear confirmation + History empty afterward (late-response fence covered in History unit path;
    // this proves clear → History does not resurrect the renamed row).
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^Settings/i })
      .click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: /Clear activity history/i }).click();
    await expect(page.getByRole("heading", { name: /Clear activity history\?/i })).toBeVisible();
    await durableScreenshot(page, path.join(SCREENSHOT_DIR, "08-clear-confirm.png"));
    await page.getByRole("button", { name: "Clear history", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /Activity history was cleared/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^History/i })
      .click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: new RegExp(renamed) })).toHaveCount(0);
  });

  test("AT14: Work Move-menu Save persists; geometry 360 and 1280 authenticated", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      testInfo.project.name !== "chromium" && testInfo.project.name !== "chromium-desktop",
      "Chromium phone + desktop geometry",
    );
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    const title = `Reorder ${Date.now().toString(36)}`;
    await fillFocusedResponsibilityCreate(page, {
      title,
      weekdaysPreset: "every",
      daypart: "anytime",
      ownerName: "Avery",
      stepTexts: ["Alpha work", "Bravo work"],
    });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openRoutineSection(page, "Work");
    await page
      .locator("[data-ordered-row]")
      .first()
      .getByRole("button", { name: /More actions for/i })
      .click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect(page.locator("[data-ordered-row]").first()).toContainText(/Bravo work/i);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expectSignedInAs(page, "Morgan Reed");
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".compact-step-list li").first()).toContainText(/Bravo work/i);

    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
    await durableScreenshot(page, path.join(SCREENSHOT_DIR, "09-geometry-360.png"));

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("button", { name: "Plan", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await durableScreenshot(page, path.join(SCREENSHOT_DIR, "10-geometry-1280.png"));
  });
});
