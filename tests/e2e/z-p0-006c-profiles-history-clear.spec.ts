import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import { expectSignedInAs, revealChecklist } from "../helpers/e2e-shell";
import { touchDragByCdp } from "../helpers/touch-drag";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_LOGIN = "e2e.avery";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const SCREENSHOT_DIR = path.resolve("test-results/runtime-screenshots/p0-006c-r1");

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

async function householdToday(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { householdDate: string }).householdDate;
}

async function claimAvery(request: APIRequestContext, displayName = "Avery Reed") {
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
        displayName,
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

async function saveCalendar(
  request: APIRequestContext,
  body: {
    expectedVersion: number;
    years: Array<{
      startDate: string;
      endDate: string;
      usualWeekdays: number[];
      exceptions: Array<{ name: string; startDate: string; endDate: string }>;
    }>;
  },
) {
  const response = await request.put("/api/v1/school-calendar", {
    headers: await mutatingHeaders(request),
    data: { mutationId: crypto.randomUUID(), ...body },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { calendar: { version: number; configured: boolean } };
}

async function ensureSchoolCalendarAllDays(request: APIRequestContext, today: string) {
  const current = await request.get("/api/v1/school-calendar");
  expect(current.ok()).toBeTruthy();
  const version = ((await current.json()) as { calendar: { version: number } }).calendar.version;
  const endYear = Number(today.slice(0, 4)) + 1;
  return saveCalendar(request, {
    expectedVersion: version,
    years: [
      {
        startDate: today,
        endDate: `${endYear}-12-31`,
        usualWeekdays: [1, 2, 3, 4, 5, 6, 7],
        exceptions: [],
      },
    ],
  });
}

async function setupSchoolOnlyRoutine(request: APIRequestContext, today: string, title: string) {
  await ensureSchoolCalendarAllDays(request, today);
  const created = await request.post("/api/v1/routines", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title,
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [AVERY_ID],
      assigneeGroupIds: [],
      steps: [
        {
          text: "Pack Lunchbox",
          obligation: "required",
          applicability: { kind: "school_days" },
        },
      ],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return ((await created.json()) as { routine: { id: string; version: number } }).routine;
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  await page.goto("/");
  await expectSignedInAs(page, "Morgan Reed");
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

async function peopleDirectoryNames(page: Page): Promise<string[]> {
  const rows = page.locator(".people-list").first().locator("button.person-row .person-name");
  return rows.allTextContents();
}

async function centerOf(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing bounding box for touch target");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function openReorder(page: Page) {
  await page.getByRole("button", { name: "Reorder people" }).click();
  await expect(page.getByRole("heading", { name: "Reorder people" })).toBeVisible();
  await expect(page.locator("[data-ordered-row]").first()).toBeVisible();
}

async function expectDirectoryOrder(page: Page, expected: string[]) {
  await expect
    .poll(async () => peopleDirectoryNames(page), { timeout: 15_000 })
    .toEqual(expected);
}

test.describe("P0-006C profiles, history, and clear", () => {
  test("phone journey: profiles, reorder, history, clear activity", async ({ page, browser }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Phone-width Chromium journey; desktop/WebKit covered elsewhere",
    );

    const suffix = Date.now().toString(36);
    const friendlyName = `Avery ${suffix}`;
    const fullName = `Avery Full ${suffix}`;
    const email = `avery.${suffix}@example.test`;
    const birthday = "2014-06-15";
    const routineTitle = `History clear ${suffix}`;

    await openAsManager(page);
    await openPeopleGroups(page);
    await durableScreenshot(page, path.join(SCREENSHOT_DIR, "directory.png"));

    await page.goto(`/household/people/${AVERY_ID}`);
    await expect(page.locator("#person-detail-heading")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Edit person" }).click();
    await expect(page.getByRole("heading", { name: "Edit person" })).toBeVisible();
    await page.getByLabel("Friendly name").fill(friendlyName);
    await page.getByLabel("Full name").fill(fullName);
    await page.getByLabel("Birthday").fill(birthday);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit person" })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: friendlyName })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(`Friendly name:`)).toContainText(friendlyName);
    await expect(page.getByText(`Full name:`)).toContainText(fullName);
    await expect(page.getByText(`Birthday:`)).toContainText(birthday);
    await expect(page.getByText(`Email:`)).toContainText(email);

    await page.reload();
    await expectSignedInAs(page, "Morgan Reed");
    await expect(page.getByRole("heading", { name: friendlyName })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(`Full name:`)).toContainText(fullName);
    await expect(page.getByText(`Birthday:`)).toContainText(birthday);
    await expect(page.getByText(`Email:`)).toContainText(email);
    await durableScreenshot(page, path.join(SCREENSHOT_DIR, "person-detail.png"));

    await page.getByRole("button", { name: "Back to People & Groups" }).click();
    await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible();
    await page.reload();
    await expectSignedInAs(page, "Morgan Reed");
    await openPeopleGroups(page);

    const baselineOrder = await peopleDirectoryNames(page);
    expect(baselineOrder.length).toBeGreaterThanOrEqual(2);
    const firstLabel = baselineOrder[0]!;
    const secondLabel = baselineOrder[1]!;

    // AT4 Cancel: Move-menu draft discarded; saved order unchanged through reload.
    await openReorder(page);
    await page.getByRole("button", { name: `More actions for ${firstLabel}` }).click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect(page.locator("[data-ordered-row]").first()).toContainText(secondLabel);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toMatch(/unsaved changes/i);
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible({
      timeout: 15_000,
    });
    await expectDirectoryOrder(page, baselineOrder);
    await page.reload();
    await expectSignedInAs(page, "Morgan Reed");
    await openPeopleGroups(page);
    await expectDirectoryOrder(page, baselineOrder);

    // AT4 keyboard Move-menu → Save → reload persistence.
    await openReorder(page);
    await page.getByRole("button", { name: `More actions for ${firstLabel}` }).click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect(page.locator("[data-ordered-row]").first()).toContainText(secondLabel);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /People order saved/i })).toBeVisible({
      timeout: 15_000,
    });
    const afterMoveSave = [secondLabel, firstLabel, ...baselineOrder.slice(2)];
    await expectDirectoryOrder(page, afterMoveSave);
    await page.reload();
    await expectSignedInAs(page, "Morgan Reed");
    await openPeopleGroups(page);
    await expectDirectoryOrder(page, afterMoveSave);

    // AT4 pointer/touch reorder → Save → reload (CDP touch, distinct from mouse).
    expect(testInfo.project.use.hasTouch, "Requires touch-capable Chromium phone project").toBeTruthy();
    const touchBaseline = await peopleDirectoryNames(page);
    const touchFirst = touchBaseline[0]!;
    const touchSecond = touchBaseline[1]!;
    await openReorder(page);
    const startHandle = page.locator("[data-ordered-row]").first().locator(".drag-handle");
    const secondRow = page.locator("[data-ordered-row]").nth(1);
    await touchDragByCdp(page, await centerOf(startHandle), await centerOf(secondRow), {
      steps: 20,
      pauseMs: 20,
    });
    await expect
      .poll(async () => {
        const text = await page.locator("[data-ordered-row]").first().innerText();
        return text.includes(touchSecond);
      })
      .toBeTruthy();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /People order saved/i })).toBeVisible({
      timeout: 15_000,
    });
    const afterTouchSave = [touchSecond, touchFirst, ...touchBaseline.slice(2)];
    await expectDirectoryOrder(page, afterTouchSave);
    await page.reload();
    await expectSignedInAs(page, "Morgan Reed");
    await openPeopleGroups(page);
    await expectDirectoryOrder(page, afterTouchSave);

    const today = await householdToday(page.request);
    await setupSchoolOnlyRoutine(page.request, today, routineTitle);

    const childContext = await browser.newContext();
    const child = await childContext.newPage();
    await claimAvery(child.request, friendlyName);
    await child.goto("/");
    await expectSignedInAs(child, friendlyName);
    const childCard = child.locator(".occurrence").filter({ hasText: routineTitle });
    await revealChecklist(childCard);
    await childCard.getByRole("button", { name: /Mark Pack Lunchbox completed/ }).click();
    await expect(child.locator(".status-pill[data-kind='pending']")).toHaveCount(0, {
      timeout: 15_000,
    });
    const completedToggle = child.getByRole("button", { name: /^Completed/ });
    await expect(completedToggle).toBeVisible({ timeout: 15_000 });
    if ((await completedToggle.getAttribute("aria-expanded")) !== "true") {
      await completedToggle.click();
    }
    await expect(
      child.locator(".occurrence").filter({ hasText: routineTitle }),
    ).toHaveAttribute("data-completed", "true", { timeout: 15_000 });
    await childContext.close();

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^History\b/ })
      .click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible({
      timeout: 15_000,
    });
    const historyRow = page.locator(".history-summary-row").filter({ hasText: routineTitle });
    await expect(historyRow).toBeVisible({ timeout: 15_000 });
    await expect(historyRow).toContainText(/Complete|Incomplete/);
    await durableScreenshot(page, path.join(SCREENSHOT_DIR, "history-summary.png"));

    await historyRow.click();
    await expect(page.getByRole("heading", { name: routineTitle })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Pack Lunchbox")).toBeVisible();
    await durableScreenshot(page, path.join(SCREENSHOT_DIR, "history-detail.png"));
    await page.getByRole("button", { name: "Back to History" }).click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(historyRow).toBeVisible();

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^Settings\b/ })
      .click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Data & testing" })).toBeVisible();

    await page.getByRole("button", { name: /Clear activity history/i }).click();
    await expect(page.getByRole("heading", { name: /Clear activity history\?/i })).toBeVisible();
    await durableScreenshot(page, path.join(SCREENSHOT_DIR, "clear-confirm.png"));
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Clear activity history\?/i })).toHaveCount(
      0,
    );

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^History\b/ })
      .click();
    await expect(page.locator(".history-summary-row").filter({ hasText: routineTitle })).toBeVisible({
      timeout: 15_000,
    });

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^Settings\b/ })
      .click();
    await page.getByRole("button", { name: /Clear activity history/i }).click();
    await page.getByRole("button", { name: "Clear history", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /Activity history was cleared/i }).first(),
    ).toBeVisible({
      timeout: 15_000,
    });

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^History\b/ })
      .click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    // Cleared completion must not remain; today may rematerialize as fresh Incomplete.
    await expect(
      page
        .locator(".history-summary-row")
        .filter({ hasText: routineTitle })
        .filter({ hasText: /· Complete ·/ }),
    ).toHaveCount(0, { timeout: 15_000 });
    const clearedEmpty = page.getByText(/No recorded routine work for this selection/i);
    const freshIncomplete = page
      .locator(".history-summary-row")
      .filter({ hasText: routineTitle })
      .filter({ hasText: /Incomplete/ });
    await expect(clearedEmpty.or(freshIncomplete)).toBeVisible({ timeout: 15_000 });
    if ((await freshIncomplete.count()) > 0) {
      await expect(freshIncomplete).toContainText(/0 completed/);
    }

    const averyContext = await browser.newContext();
    const avery = await averyContext.newPage();
    await claimAvery(avery.request, friendlyName);
    await avery.goto("/");
    await expectSignedInAs(avery, friendlyName);
    const freshCard = avery.locator(".occurrence").filter({ hasText: routineTitle });
    await revealChecklist(freshCard);
    await expect(freshCard.getByText(/Status:\s*Open/i)).toBeVisible();
    await expect(freshCard.getByRole("button", { name: /Mark Pack Lunchbox completed/ })).toBeEnabled();
    await averyContext.close();
  });
});
