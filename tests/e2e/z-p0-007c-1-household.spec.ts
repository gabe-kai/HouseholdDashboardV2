import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import {
  ensureManagerSession,
  expectSignedInAs,
  sessionDisplayName,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const AVERY_LOGIN = "e2e.avery";
const CASEY_LOGIN = "e2e.casey.c1";
const JORDAN_LOGIN = "e2e.jordan.c1";

const MORGAN_ID = "22222222-2222-4222-8222-222222222201";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const JORDAN_ID = "22222222-2222-4222-8222-222222222203";
const CASEY_ID = "22222222-2222-4222-8222-222222222204";
const TAYLOR_ID = "22222222-2222-4222-8222-222222222205";

type OccurrenceFixture = {
  id: string;
  title: string;
  kind: string;
  revisionId: string;
  accountableMemberId: string | null;
  completed: boolean;
  steps: Array<{ id: string; status: string; logicalItemId?: string | null }>;
};

function requestOrigin(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
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

async function ensureManagerRequest(request: APIRequestContext) {
  const origin = requestOrigin();
  const boot = await request.post("/api/v1/test/bootstrap-claim");
  if (boot.ok()) {
    const { token } = (await boot.json()) as { token: string };
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: origin },
      data: {
        claimToken: token,
        loginName: "e2e.manager",
        passphrase: PASSPHRASE,
        displayName: "Morgan Reed",
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: "e2e.manager", passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function claimMember(
  request: APIRequestContext,
  membershipId: string,
  loginName: string,
  displayName: string,
) {
  await ensureManagerRequest(request);
  const enroll = await request.post("/api/v1/enrollment/claims", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      membershipId,
      preset: "direct_personalizer",
    },
  });
  if (enroll.ok()) {
    const token = ((await enroll.json()) as { claim: { token: string } }).claim.token;
    await request.post("/api/v1/auth/logout", { headers: await mutatingHeaders(request) });
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: requestOrigin() },
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
  await request.post("/api/v1/auth/logout", { headers: await mutatingHeaders(request) });
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: requestOrigin() },
    data: { loginName, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function claimAvery(request: APIRequestContext) {
  await claimMember(request, AVERY_ID, AVERY_LOGIN, "Avery Reed");
}

async function sessionMeta(request: APIRequestContext) {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return (await session.json()) as {
    householdDate: string;
    activityGeneration?: number;
    member?: { displayName?: string };
  };
}

async function fetchTodayOccurrences(
  request: APIRequestContext,
  date: string,
): Promise<OccurrenceFixture[]> {
  const res = await request.get(`/api/v1/today?date=${encodeURIComponent(date)}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { occurrences: OccurrenceFixture[] }).occurrences;
}

async function completeSteps(
  request: APIRequestContext,
  occurrence: OccurrenceFixture,
  stepIds: string[],
  activityGeneration: number,
) {
  for (const stepId of stepIds) {
    const payload: Record<string, unknown> = {
      mutationId: crypto.randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration,
      kind: occurrence.kind,
    };
    if (occurrence.kind === "responsibility") {
      payload.intendedStructure = {
        revisionId: occurrence.revisionId,
        accountableMemberId: occurrence.accountableMemberId,
        stepLogicalIds: occurrence.steps.map((s) => s.logicalItemId!).filter(Boolean),
      };
    }
    const complete = await request.post(
      `/api/v1/occurrences/${occurrence.id}/steps/${stepId}/status`,
      {
        headers: await mutatingHeaders(request),
        data: payload,
      },
    );
    expect(complete.ok(), await complete.text()).toBeTruthy();
  }
}

async function openHouseholdRoot(page: Page) {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Household", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Household", exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("P0-007C-1 Household overview", () => {
  test("AT6: four-owner overview matrix, drill-down, manage links", async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(
      testInfo.project.name === "chromium-desktop",
      "Phone Chromium/WebKit own this journey",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const suffix = Date.now().toString(36);
    const kitchenTitle = `C1 HH Kitchen ${suffix}`;
    const catsTitle = `C1 HH Cats ${suffix}`;
    const bathroomTitle = `C1 HH Bathroom ${suffix}`;
    const trashTitle = `C1 HH Trash ${suffix}`;
    const morningTitle = `C1 HH Morning ${suffix}`;
    const afterTitle = `C1 HH After ${suffix}`;

    await ensureManagerSession(page);
    await createFixtures(page.request, {
      kitchenTitle,
      catsTitle,
      bathroomTitle,
      trashTitle,
      morningTitle,
      afterTitle,
    });

    // Distinct owners/states require the accountable members to act (own-execute only).
    const caseyContext = await browser.newContext();
    const jordanContext = await browser.newContext();
    const averyContext = await browser.newContext();
    const casey = await caseyContext.newPage();
    const jordan = await jordanContext.newPage();
    const avery = await averyContext.newPage();

    await claimMember(casey.request, CASEY_ID, CASEY_LOGIN, "Casey Reed");
    const caseyMeta = await sessionMeta(casey.request);
    const caseyOcc = (await fetchTodayOccurrences(casey.request, caseyMeta.householdDate)).find(
      (o) => o.title === catsTitle,
    );
    expect(caseyOcc, "Casey Cats occurrence").toBeTruthy();
    expect(caseyOcc!.steps.length).toBeGreaterThanOrEqual(2);
    await completeSteps(
      casey.request,
      caseyOcc!,
      [caseyOcc!.steps[0]!.id],
      caseyMeta.activityGeneration ?? 0,
    );

    await claimMember(jordan.request, JORDAN_ID, JORDAN_LOGIN, "Jordan Reed");
    const jordanMeta = await sessionMeta(jordan.request);
    const jordanOcc = (
      await fetchTodayOccurrences(jordan.request, jordanMeta.householdDate)
    ).find((o) => o.title === bathroomTitle);
    expect(jordanOcc, "Jordan Bathroom occurrence").toBeTruthy();
    await completeSteps(
      jordan.request,
      jordanOcc!,
      jordanOcc!.steps.map((s) => s.id),
      jordanMeta.activityGeneration ?? 0,
    );

    await claimAvery(avery.request);
    const averyMeta = await sessionMeta(avery.request);
    const averyMorning = (
      await fetchTodayOccurrences(avery.request, averyMeta.householdDate)
    ).find((o) => o.title === morningTitle);
    expect(averyMorning, "Avery Morning occurrence").toBeTruthy();
    await completeSteps(
      avery.request,
      averyMorning!,
      averyMorning!.steps.map((s) => s.id),
      averyMeta.activityGeneration ?? 0,
    );

    await caseyContext.close();
    await jordanContext.close();
    await averyContext.close();

    await page.goto("/");
    const name = await sessionDisplayName(page);
    await expectSignedInAs(page, name || /Morgan/);

    await openHouseholdRoot(page);

    // Summary-first: not the old destination-menu-only landing.
    await expect(page.getByRole("heading", { name: "Household activity", exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText(/What still needs attention/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Responsibilities" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible();

    const kitchenRow = page.locator(".compact-activity-row").filter({ hasText: kitchenTitle });
    const catsRow = page.locator(".compact-activity-row").filter({ hasText: catsTitle });
    const bathroomRow = page.locator(".compact-activity-row").filter({ hasText: bathroomTitle });
    const trashRow = page.locator(".compact-activity-row").filter({ hasText: trashTitle });
    await expect(kitchenRow).toBeVisible({ timeout: 20_000 });
    await expect(catsRow).toBeVisible({ timeout: 20_000 });
    await expect(bathroomRow).toBeVisible({ timeout: 20_000 });
    await expect(trashRow).toBeVisible({ timeout: 20_000 });

    // AT6 matrix: four fictional owners + distinct states from the overview (no checklist open).
    await expect(kitchenRow).toContainText(/Avery/);
    await expect(kitchenRow).toContainText(/Not started/);
    await expect(catsRow).toContainText(/Casey/);
    await expect(catsRow).toContainText(/In progress/);
    await expect(bathroomRow).toContainText(/Jordan/);
    await expect(bathroomRow).toContainText(/Complete/);
    await expect(trashRow).toContainText(/Taylor/);
    await expect(trashRow).toContainText(/Not started/);

    const morningRow = page.locator(".compact-activity-row").filter({ hasText: morningTitle });
    const afterRow = page.locator(".compact-activity-row").filter({ hasText: afterTitle });
    await expect(morningRow).toBeVisible({ timeout: 20_000 });
    await expect(afterRow).toBeVisible({ timeout: 20_000 });
    await expect(morningRow).toContainText(/1\/4 people complete/);
    await expect(afterRow).toContainText(/0\/2 people complete/);

    // Drill routine -> person without losing the aggregate origin.
    await morningRow.click();
    await expect(page.getByRole("heading", { name: morningTitle })).toBeVisible({ timeout: 15_000 });
    const personRow = page.locator(".compact-activity-row").filter({ hasText: /Avery|Morgan/i }).first();
    await expect(personRow).toBeVisible({ timeout: 15_000 });
    await personRow.click();
    await expect(page.locator(".checklist").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: new RegExp(`Back to ${morningTitle}`) }).click();
    await expect(page.getByRole("heading", { name: morningTitle })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Back to Household/i }).click();
    await expect(page.getByRole("heading", { name: "Household", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(morningRow).toBeVisible({ timeout: 15_000 });

    // Drill responsibility -> composed work; return to the origin row.
    await kitchenRow.click();
    await expect(page.getByRole("heading", { name: kitchenTitle })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".checklist").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Back to Household/i }).click();
    await expect(page.getByRole("heading", { name: "Household", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(kitchenRow).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "Manage" })).toBeVisible();
    const manageNav = page.getByRole("navigation", { name: "Household management" });
    await manageNav.getByRole("button", { name: /People & Groups/i }).click();
    await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "Household", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("navigation", { name: "Household management" })
      .getByRole("button", { name: /^History/i })
      .click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible({ timeout: 15_000 });
  });

  test("AT5: Household overview shows shared personal tasks, not private", async ({
    browser,
  }: {
    browser: Browser;
  }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(
      testInfo.project.name === "chromium-desktop",
      "Phone Chromium/WebKit own this journey",
    );
    const suffix = Date.now().toString(36);
    const privateTitle = `C1 Private ${suffix}`;
    const sharedTitle = `C1 Shared ${suffix}`;

    const managerContext = await browser.newContext();
    const childContext = await browser.newContext();
    const manager = await managerContext.newPage();
    const child = await childContext.newPage();

    await ensureManagerSession(manager);
    await claimAvery(child.request);

    await child.goto("/");
    await expectSignedInAs(child, /Avery/);

    await child.getByRole("button", { name: "Add task" }).click();
    await child.getByPlaceholder("Add a personal task").fill(privateTitle);
    await child.getByLabel("Task visibility").selectOption("private");
    await child.getByRole("button", { name: "Save", exact: true }).click();
    await expect(child.getByText(privateTitle)).toBeVisible({ timeout: 15_000 });

    await child.getByRole("button", { name: "Add task" }).click();
    await child.getByPlaceholder("Add a personal task").fill(sharedTitle);
    await child.getByLabel("Task visibility").selectOption("household");
    await child.getByRole("button", { name: "Save", exact: true }).click();
    await expect(child.getByText(sharedTitle)).toBeVisible({ timeout: 15_000 });

    await manager.goto("/");
    const name = await sessionDisplayName(manager);
    await expectSignedInAs(manager, name || /Morgan/);
    await openHouseholdRoot(manager);
    await expect(
      manager.getByRole("heading", { name: "Household-visible personal tasks" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(manager.getByText(sharedTitle)).toBeVisible({ timeout: 15_000 });
    await expect(manager.getByText(privateTitle)).toHaveCount(0);

    await managerContext.close();
    await childContext.close();
  });
});

async function createFixtures(
  request: APIRequestContext,
  titles: {
    kitchenTitle: string;
    catsTitle: string;
    bathroomTitle: string;
    trashTitle: string;
    morningTitle: string;
    afterTitle: string;
  },
) {
  const kitchen = await request.post("/api/v1/responsibilities", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: titles.kitchenTitle,
      daypart: "evening",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: AVERY_ID,
      steps: [{ text: "Wipe counters", obligation: "required" }],
    },
  });
  expect(kitchen.ok(), await kitchen.text()).toBeTruthy();

  const cats = await request.post("/api/v1/responsibilities", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: titles.catsTitle,
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: CASEY_ID,
      steps: [
        { text: "Feed cats", obligation: "required" },
        { text: "Scoop litter", obligation: "required" },
      ],
    },
  });
  expect(cats.ok(), await cats.text()).toBeTruthy();

  const bathroom = await request.post("/api/v1/responsibilities", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: titles.bathroomTitle,
      daypart: "evening",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: JORDAN_ID,
      steps: [{ text: "Towels", obligation: "required" }],
    },
  });
  expect(bathroom.ok(), await bathroom.text()).toBeTruthy();

  const trash = await request.post("/api/v1/responsibilities", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: titles.trashTitle,
      daypart: "evening",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: TAYLOR_ID,
      steps: [{ text: "Take bins out", obligation: "required" }],
    },
  });
  expect(trash.ok(), await trash.text()).toBeTruthy();

  const morning = await request.post("/api/v1/routines", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: titles.morningTitle,
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [MORGAN_ID, AVERY_ID, CASEY_ID, JORDAN_ID],
      assigneeGroupIds: [],
      steps: [{ text: "Make bed", obligation: "required" }],
    },
  });
  expect(morning.ok(), await morning.text()).toBeTruthy();

  const after = await request.post("/api/v1/routines", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: titles.afterTitle,
      daypart: "after_school",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [CASEY_ID, JORDAN_ID],
      assigneeGroupIds: [],
      steps: [{ text: "Unpack bag", obligation: "required" }],
    },
  });
  expect(after.ok(), await after.text()).toBeTruthy();

  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const today = ((await session.json()) as { householdDate: string }).householdDate;
  const todayRes = await request.get(`/api/v1/today?date=${encodeURIComponent(today)}`);
  expect(todayRes.ok(), await todayRes.text()).toBeTruthy();
}
