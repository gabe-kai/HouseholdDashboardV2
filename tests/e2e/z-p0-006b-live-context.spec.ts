import { test, expect, type Page, type APIRequestContext, type Browser } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_LOGIN = "e2e.avery";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";

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

async function ensureSchoolCalendarAllDays(
  request: APIRequestContext,
  today: string,
  exceptions: Array<{ name: string; startDate: string; endDate: string }> = [],
) {
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
        exceptions,
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

async function triggerVisibilityRefresh(page: Page) {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/today") &&
        !response.url().includes("date=") &&
        response.request().method() === "GET" &&
        response.ok(),
      { timeout: 15_000 },
    ),
    page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }),
  ]);
}

test.describe("P0-006B live context and pending recovery", () => {
  test("AT10: pending first-action card survives omitted empty occurrence", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const managerContext = await browser.newContext();
    const childContext = await browser.newContext();
    const manager = await managerContext.newPage();
    const child = await childContext.newPage();
    const suffix = Date.now().toString(36);
    const title = `Pending omit ${suffix}`;

    await ensureManagerSession(manager.request);
    await claimAvery(child.request);
    const today = await householdToday(manager.request);
    await setupSchoolOnlyRoutine(manager.request, today, title);

    await child.goto("/");
    await expectSignedInAs(child, "Avery Reed");
    const childCard = child.locator(".occurrence").filter({ hasText: title });
    await expect(childCard).toBeVisible({ timeout: 15_000 });
    await expect(childCard.getByText("Pack Lunchbox")).toBeVisible();

    await child.route("**/api/v1/occurrences/**", (route) => route.abort());
    await childCard.getByRole("button", { name: /Mark Pack Lunchbox completed/ }).click();
    await expect(child.locator(".status-pill[data-kind='pending']")).toBeVisible();

    await ensureSchoolCalendarAllDays(manager.request, today, [
      { name: "No school today", startDate: today, endDate: today },
    ]);

    // Authoritative Today omits the filtered-empty unstarted occurrence.
    await expect
      .poll(async () => {
        const response = await manager.request.get("/api/v1/today");
        if (!response.ok()) return "error";
        const body = (await response.json()) as {
          occurrences: Array<{ title: string; accountableMemberName: string }>;
        };
        return body.occurrences.some(
          (occurrence) =>
            occurrence.title === title && occurrence.accountableMemberName === "Avery Reed",
        )
          ? "present"
          : "omitted";
      })
      .toBe("omitted");

    await triggerVisibilityRefresh(child);
    await expect(child.locator(".occurrence").filter({ hasText: title })).toBeVisible();
    await expect(child.locator(".occurrence").filter({ hasText: title }).getByText("Pack Lunchbox")).toBeVisible();
    await expect(child.locator(".status-pill[data-kind='pending']")).toBeVisible();

    await child.reload();
    await expectSignedInAs(child, "Avery Reed");
    await expect(child.locator(".occurrence").filter({ hasText: title })).toBeVisible({
      timeout: 15_000,
    });
    await expect(child.locator(".status-pill[data-kind='pending']")).toBeVisible();

    await child.unroute("**/api/v1/occurrences/**");
    await child.reload();
    await expectSignedInAs(child, "Avery Reed");
    await expect
      .poll(async () => {
        const errorPill = await child.locator(".status-pill[data-kind='error']").count();
        const pending = await child.locator(".status-pill[data-kind='pending']").count();
        const alert = await child.getByRole("alert").count();
        if (errorPill > 0 || alert > 0) return "rejected";
        if (pending === 0) return "cleared";
        return "pending";
      })
      .not.toBe("pending");

    await managerContext.close();
    await childContext.close();
  });

  test("AT11: live school_calendar invalidation, dirty draft, visibility recovery", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const viewerContext = await browser.newContext();
    const editorContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    const editor = await editorContext.newPage();
    const suffix = Date.now().toString(36);
    const title = `Live context ${suffix}`;

    await ensureManagerSession(editor.request);
    await claimAvery(viewer.request);
    const today = await householdToday(editor.request);
    const routine = await setupSchoolOnlyRoutine(editor.request, today, title);

    await viewer.goto("/");
    await expectSignedInAs(viewer, "Avery Reed");
    const viewerCard = viewer.locator(".occurrence").filter({ hasText: title });
    await expect(viewerCard).toBeVisible({ timeout: 15_000 });
    await expect(viewerCard.getByText("Pack Lunchbox")).toBeVisible();

    await editor.goto("/");
    await expectSignedInAs(editor, "Morgan Reed");
    await editor.getByRole("button", { name: "Plan", exact: true }).click();
    await editor.getByRole("button", { name: new RegExp(title) }).first().click();
    await expect(editor.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await editor.getByRole("button", { name: "Show preview", exact: true }).click();
    await expect(editor.locator(".plan-preview-result")).toContainText("Pack Lunchbox", {
      timeout: 10_000,
    });

    // --- Live Today + open preview update without reload ---
    await Promise.all([
      viewer.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/today") &&
          response.request().method() === "GET" &&
          response.ok(),
        { timeout: 15_000 },
      ),
      editor.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/personal-layer/preview") &&
          response.request().method() === "GET" &&
          response.ok(),
        { timeout: 15_000 },
      ),
      ensureSchoolCalendarAllDays(editor.request, today, [
        { name: "Break day", startDate: today, endDate: today },
      ]),
    ]);
    await expect(viewer.locator(".occurrence").filter({ hasText: title })).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(editor.locator(".plan-preview-result")).toContainText("No steps apply", {
      timeout: 15_000,
    });
    await expect(editor.locator(".plan-preview-result")).toContainText("Not a school day");

    // --- Dirty calendar draft survives remote save with conflict handling ---
    await editor.getByRole("button", { name: "Household", exact: true }).click();
    await editor.getByRole("button", { name: /School calendar/i }).click();
    await editor.getByRole("button", { name: "Edit", exact: true }).click();
    const yearEnd = editor
      .locator(".calendar-year-block > label")
      .filter({ hasText: /^End date/ })
      .locator("input");
    const dirtyEnd = `${Number(today.slice(0, 4)) + 2}-06-15`;
    await yearEnd.fill(dirtyEnd);
    await expect(yearEnd).toHaveValue(dirtyEnd);

    await ensureSchoolCalendarAllDays(editor.request, today, [
      { name: "Break day", startDate: today, endDate: today },
    ]);

    await expect(yearEnd).toHaveValue(dirtyEnd);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    await expect(yearEnd).toHaveValue(dirtyEnd);

    // --- Missed notification + visibility recovery ---
    await viewer.getByRole("button", { name: "Today", exact: true }).click();
    const muted = await viewer.evaluate(() => {
      const api = (
        window as unknown as {
          __hdSync?: { ignoreMessagesForTest: (ignore: boolean) => void };
        }
      ).__hdSync;
      if (!api?.ignoreMessagesForTest) return false;
      api.ignoreMessagesForTest(true);
      return true;
    });
    expect(muted).toBe(true);

    await ensureSchoolCalendarAllDays(editor.request, today, []);
    await expect(viewer.locator(".occurrence").filter({ hasText: title })).toHaveCount(0);

    await viewer.evaluate(() => {
      (
        window as unknown as {
          __hdSync?: { ignoreMessagesForTest: (ignore: boolean) => void };
        }
      ).__hdSync?.ignoreMessagesForTest(false);
    });
    await triggerVisibilityRefresh(viewer);
    await expect(viewer.locator(".occurrence").filter({ hasText: title })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      viewer.locator(".occurrence").filter({ hasText: title }).getByText("Pack Lunchbox"),
    ).toBeVisible();

    expect(routine.id).toBeTruthy();

    await viewerContext.close();
    await editorContext.close();
  });
});
