import { test, expect, type Page, type APIRequestContext, type Browser } from "@playwright/test";
import { expectSignedInAs, revealChecklist } from "../helpers/e2e-shell";

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

async function clearActivityViaApi(request: APIRequestContext) {
  const today = await request.get("/api/v1/today");
  expect(today.ok(), await today.text()).toBeTruthy();
  const { activityGeneration } = (await today.json()) as { activityGeneration: number };
  const cleared = await request.post("/api/v1/household/activity/clear", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      expectedGeneration: activityGeneration,
      acknowledgedScope: "routines_and_responsibilities",
    },
  });
  expect(cleared.ok(), await cleared.text()).toBeTruthy();
  return (await cleared.json()) as { activityGeneration: number };
}

async function averyDisplayName(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const body = (await session.json()) as {
    member?: { displayName?: string };
    membership?: { displayName?: string };
  };
  return body.member?.displayName ?? body.membership?.displayName ?? "Avery Reed";
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

test.describe("P0-006C reset-aware outbox", () => {
  test("clear retires pending first-action outbox across contexts", async ({
    browser,
  }: {
    browser: Browser;
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Multi-context Chromium reset journey",
    );

    const managerContext = await browser.newContext();
    const childContext = await browser.newContext();
    const manager = await managerContext.newPage();
    const child = await childContext.newPage();
    const suffix = Date.now().toString(36);
    const title = `Reset outbox ${suffix}`;

    await ensureManagerSession(manager.request);
    await claimAvery(child.request);
    const averyName = await averyDisplayName(child.request);
    const today = await householdToday(manager.request);
    await setupSchoolOnlyRoutine(manager.request, today, title);

    await child.goto("/");
    await expectSignedInAs(child, averyName);
    const childCard = child.locator(".occurrence").filter({ hasText: title });
    await expect(childCard).toBeVisible({ timeout: 15_000 });
    await revealChecklist(childCard);
    await expect(childCard.getByText("Pack Lunchbox")).toBeVisible();

    await child.route("**/api/v1/occurrences/**", (route) => route.abort());
    await childCard.getByRole("button", { name: /Mark Pack Lunchbox completed/ }).click();
    await expect(child.locator(".status-pill[data-kind='pending']")).toBeVisible();
    await expect(child.locator(".occurrence").filter({ hasText: title })).toBeVisible();

    await clearActivityViaApi(manager.request);

    await child.unroute("**/api/v1/occurrences/**");
    await child.reload();
    await expectSignedInAs(child, averyName);
    await revealChecklist(child.locator(".occurrence").filter({ hasText: title }));

    await expect
      .poll(async () => {
        const pending = await child.locator(".status-pill[data-kind='pending']").count();
        const banner = await child.locator(".activity-reset-banner").count();
        const card = child.locator(".occurrence").filter({ hasText: title });
        const cardCount = await card.count();
        const openReady =
          cardCount > 0 &&
          (await card.getByRole("button", { name: /Mark Pack Lunchbox completed/ }).count()) > 0 &&
          (await card.getByText(/Status:\s*Open/i).count()) > 0;
        if (pending > 0) return "pending-ghost";
        if (openReady) return banner > 0 ? "cleared-with-banner" : "cleared-fresh";
        return "waiting";
      }, { timeout: 20_000 })
      .toMatch(/^cleared/);

    await expect(child.locator(".status-pill[data-kind='pending']")).toHaveCount(0);
    const freshCard = child.locator(".occurrence").filter({ hasText: title });
    await expect(freshCard).toBeVisible({ timeout: 15_000 });
    await expect(freshCard.getByText(/Status:\s*Open/i)).toBeVisible();
    await expect(freshCard.getByRole("button", { name: /Mark Pack Lunchbox completed/ })).toBeEnabled();

    await freshCard.getByRole("button", { name: /Mark Pack Lunchbox completed/ }).click();
    await expect(child.locator(".status-pill[data-kind='pending']")).toHaveCount(0, {
      timeout: 15_000,
    });
    const completedToggle = child.getByRole("button", { name: /^Completed/ });
    await expect(completedToggle).toBeVisible({ timeout: 15_000 });
    if ((await completedToggle.getAttribute("aria-expanded")) !== "true") {
      await completedToggle.click();
    }
    await expect(
      child.locator(".occurrence").filter({ hasText: title }),
    ).toHaveAttribute("data-completed", "true", { timeout: 15_000 });

    await managerContext.close();
    await childContext.close();
  });

  test("same-generation omit retention still keeps pending card", async ({
    browser,
  }: {
    browser: Browser;
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Multi-context Chromium omit check",
    );

    const managerContext = await browser.newContext();
    const childContext = await browser.newContext();
    const manager = await managerContext.newPage();
    const child = await childContext.newPage();
    const suffix = Date.now().toString(36);
    const title = `Omit retain ${suffix}`;

    await ensureManagerSession(manager.request);
    await claimAvery(child.request);
    const averyName = await averyDisplayName(child.request);
    const today = await householdToday(manager.request);
    await setupSchoolOnlyRoutine(manager.request, today, title);

    await child.goto("/");
    await expectSignedInAs(child, averyName);
    const childCard = child.locator(".occurrence").filter({ hasText: title });
    await expect(childCard).toBeVisible({ timeout: 15_000 });
    await revealChecklist(childCard);

    await child.route("**/api/v1/occurrences/**", (route) => route.abort());
    await childCard.getByRole("button", { name: /Mark Pack Lunchbox completed/ }).click();
    await expect(child.locator(".status-pill[data-kind='pending']")).toBeVisible();

    await ensureSchoolCalendarAllDays(manager.request, today, [
      { name: "No school today", startDate: today, endDate: today },
    ]);

    await expect
      .poll(async () => {
        const response = await manager.request.get("/api/v1/today");
        if (!response.ok()) return "error";
        const body = (await response.json()) as {
          occurrences: Array<{ title: string; accountableMemberName: string }>;
        };
        return body.occurrences.some((occurrence) => occurrence.title === title)
          ? "present"
          : "omitted";
      })
      .toBe("omitted");

    await triggerVisibilityRefresh(child);
    await expect(child.locator(".occurrence").filter({ hasText: title })).toBeVisible();
    await expect(child.locator(".status-pill[data-kind='pending']")).toBeVisible();

    await managerContext.close();
    await childContext.close();
  });
});
