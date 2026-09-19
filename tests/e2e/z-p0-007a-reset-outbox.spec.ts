import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
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

async function averyDisplayName(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const body = (await session.json()) as {
    member?: { displayName?: string };
  };
  return body.member?.displayName ?? "Avery Reed";
}

async function setupMixedWork(request: APIRequestContext, today: string, suffix: string) {
  const routine = await request.post("/api/v1/routines", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: `Reset routine ${suffix}`,
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [AVERY_ID],
      assigneeGroupIds: [],
      steps: [{ text: "Routine step", obligation: "required" }],
    },
  });
  expect(routine.ok(), await routine.text()).toBeTruthy();

  const responsibility = await request.post("/api/v1/responsibilities", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: `Reset cats ${suffix}`,
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: AVERY_ID,
      steps: [{ text: "Feed", obligation: "required" }],
    },
  });
  expect(responsibility.ok(), await responsibility.text()).toBeTruthy();

  // Touch today materialization so both cards exist.
  const todayRes = await request.get(`/api/v1/today?date=${encodeURIComponent(today)}`);
  expect(todayRes.ok(), await todayRes.text()).toBeTruthy();
  return {
    routineTitle: `Reset routine ${suffix}`,
    responsibilityTitle: `Reset cats ${suffix}`,
  };
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

test.describe("P0-007A mixed-kind reset outbox", () => {
  test("clear retires mixed-kind pending outbox across contexts", async ({
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

    await ensureManagerSession(manager.request);
    await claimAvery(child.request);
    const averyName = await averyDisplayName(child.request);
    const today = await householdToday(manager.request);
    const titles = await setupMixedWork(manager.request, today, suffix);

    await child.goto("/");
    await expectSignedInAs(child, averyName);
    const routineCard = child.locator(".occurrence").filter({ hasText: titles.routineTitle });
    const catsCard = child.locator(".occurrence").filter({ hasText: titles.responsibilityTitle });
    await expect(routineCard).toBeVisible({ timeout: 15_000 });
    await expect(catsCard).toBeVisible({ timeout: 15_000 });

    await child.route("**/api/v1/occurrences/**", (route) => route.abort());
    await routineCard.getByRole("button", { name: /Mark Routine step completed/ }).click();
    await catsCard.getByRole("button", { name: /Mark Feed completed/ }).click();
    await expect(child.locator(".status-pill[data-kind='pending']")).toBeVisible();

    await clearActivityViaApi(manager.request);

    await child.unroute("**/api/v1/occurrences/**");
    await child.reload();
    await expectSignedInAs(child, averyName);

    await expect
      .poll(async () => {
        const pending = await child.locator(".status-pill[data-kind='pending']").count();
        const banner = await child.locator(".activity-reset-banner").count();
        const routineCard = child.locator(".occurrence").filter({ hasText: titles.routineTitle });
        const catsCard = child
          .locator(".occurrence")
          .filter({ hasText: titles.responsibilityTitle });
        const routineOpen =
          (await routineCard.count()) > 0 &&
          (await routineCard.getByText(/Status:\s*Open/i).count()) > 0;
        const catsOpen =
          (await catsCard.count()) > 0 &&
          (await catsCard.getByText(/Status:\s*Open/i).count()) > 0;
        if (pending > 0) return "pending-ghost";
        if (routineOpen && catsOpen) return banner > 0 ? "cleared-with-banner" : "cleared-fresh";
        return "waiting";
      }, { timeout: 20_000 })
      .toMatch(/^cleared/);

    await expect(child.locator(".status-pill[data-kind='pending']")).toHaveCount(0);
    const freshRoutine = child.locator(".occurrence").filter({ hasText: titles.routineTitle });
    const freshCats = child.locator(".occurrence").filter({ hasText: titles.responsibilityTitle });
    await expect(freshRoutine).toBeVisible();
    await expect(freshCats).toBeVisible();
    await expect(freshRoutine.getByText(/Status:\s*Open/i)).toBeVisible();
    await expect(freshCats.getByText(/Status:\s*Open/i)).toBeVisible();

    await managerContext.close();
    await childContext.close();
  });
});
