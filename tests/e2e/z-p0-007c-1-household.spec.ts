import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import {
  ensureManagerSession,
  expectSignedInAs,
  sessionDisplayName,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const AVERY_LOGIN = "e2e.avery";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const CASEY_ID = "22222222-2222-4222-8222-222222222204";
const MORGAN_ID = "22222222-2222-4222-8222-222222222201";

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

async function claimAvery(request: APIRequestContext) {
  await ensureManagerRequest(request);
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
      headers: { Origin: requestOrigin() },
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
    headers: { Origin: requestOrigin() },
    data: { loginName: AVERY_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
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
  test("AT6: overview first, drill-down, manage links", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      testInfo.project.name === "chromium-desktop",
      "Phone Chromium/WebKit own this journey",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const suffix = Date.now().toString(36);
    const kitchenTitle = `C1 HH Kitchen ${suffix}`;
    const catsTitle = `C1 HH Cats ${suffix}`;
    const routineTitle = `C1 HH Morning ${suffix}`;

    await ensureManagerSession(page);
    await createFixtures(page.request, { kitchenTitle, catsTitle, routineTitle });
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
    await expect(kitchenRow).toBeVisible({ timeout: 20_000 });
    await expect(catsRow).toBeVisible({ timeout: 20_000 });

    const routineRow = page.locator(".compact-activity-row").filter({ hasText: routineTitle });
    await expect(routineRow).toBeVisible({ timeout: 20_000 });
    await expect(routineRow).toContainText(/\d+\/\d+ people complete/);

    await routineRow.click();
    await expect(page.getByRole("heading", { name: routineTitle })).toBeVisible({ timeout: 15_000 });
    const personRow = page.locator(".compact-activity-row").filter({ hasText: /Avery|Morgan/i }).first();
    await expect(personRow).toBeVisible({ timeout: 15_000 });
    await personRow.click();
    await expect(page.locator(".checklist").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: new RegExp(`Back to ${routineTitle}`) }).click();
    await expect(page.getByRole("heading", { name: routineTitle })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Back to Household/i }).click();
    await expect(page.getByRole("heading", { name: "Household", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(routineRow).toBeVisible({ timeout: 15_000 });

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
  titles: { kitchenTitle: string; catsTitle: string; routineTitle: string },
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
      steps: [{ text: "Feed cats", obligation: "required" }],
    },
  });
  expect(cats.ok(), await cats.text()).toBeTruthy();

  const routine = await request.post("/api/v1/routines", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: titles.routineTitle,
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [MORGAN_ID, AVERY_ID],
      assigneeGroupIds: [],
      steps: [{ text: "Make bed", obligation: "required" }],
    },
  });
  expect(routine.ok(), await routine.text()).toBeTruthy();

  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const today = ((await session.json()) as { householdDate: string }).householdDate;
  const todayRes = await request.get(`/api/v1/today?date=${encodeURIComponent(today)}`);
  expect(todayRes.ok(), await todayRes.text()).toBeTruthy();
}
