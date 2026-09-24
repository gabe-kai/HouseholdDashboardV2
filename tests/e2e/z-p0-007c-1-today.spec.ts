import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const AVERY_LOGIN = "e2e.avery";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";

type TodayOccurrence = {
  id: string;
  title: string;
  daypart: string;
  kind: string;
  completed: boolean;
  revisionId: string;
  accountableMemberId: string;
  steps: Array<{ id: string; text: string; logicalItemId?: string; status: string }>;
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

async function sessionMeta(request: APIRequestContext) {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return (await session.json()) as {
    householdDate: string;
    activityGeneration?: number;
    member?: { displayName?: string };
  };
}

async function createRoutine(
  request: APIRequestContext,
  options: {
    title: string;
    daypart: string;
    steps: Array<{ text: string; obligation?: string }>;
    assigneeMemberIds?: string[];
  },
) {
  const created = await request.post("/api/v1/routines", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: options.title,
      daypart: options.daypart,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: options.assigneeMemberIds ?? [AVERY_ID],
      assigneeGroupIds: [],
      steps: options.steps.map((step) => ({
        text: step.text,
        obligation: step.obligation ?? "required",
      })),
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return ((await created.json()) as { routine: { id: string } }).routine;
}

async function createResponsibility(
  request: APIRequestContext,
  options: {
    title: string;
    daypart: string;
    steps: Array<{ text: string; obligation?: string }>;
  },
) {
  const created = await request.post("/api/v1/responsibilities", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: options.title,
      daypart: options.daypart,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: AVERY_ID,
      steps: options.steps.map((step) => ({
        text: step.text,
        obligation: step.obligation ?? "required",
      })),
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return ((await created.json()) as { responsibility: { id: string } }).responsibility;
}

async function fetchTodayOccurrences(
  request: APIRequestContext,
  date: string,
): Promise<TodayOccurrence[]> {
  const res = await request.get(`/api/v1/today?date=${encodeURIComponent(date)}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { occurrences: TodayOccurrence[] }).occurrences;
}

async function completeSteps(
  request: APIRequestContext,
  occurrence: TodayOccurrence,
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

async function addPersonalTask(page: Page, title: string, visibility: "private" | "household") {
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByPlaceholder("Add a personal task").fill(title);
  await page.getByLabel("Task visibility").selectOption(visibility);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
}

test.describe("P0-007C-1 actionable Today", () => {
  test("AT2: Completed quiet, Next After school alone, Later compact, Anytime personal", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      testInfo.project.name === "chromium-desktop",
      "Phone Chromium/WebKit own this journey",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const suffix = Date.now().toString(36);
    const morningTitle = `C1 Morning ${suffix}`;
    const afterTitle = `C1 After school ${suffix}`;
    const kitchenTitle = `C1 Kitchen ${suffix}`;
    const bedtimeTitle = `C1 Bedtime ${suffix}`;
    const personalTitle = `C1 Pack bag ${suffix}`;

    await ensureManagerRequest(page.request);
    await createRoutine(page.request, {
      title: morningTitle,
      daypart: "morning",
      steps: [
        { text: "Make bed" },
        { text: "Brush teeth" },
      ],
    });
    await createRoutine(page.request, {
      title: afterTitle,
      daypart: "after_school",
      steps: [
        { text: "Snack" },
        { text: "Homework start" },
        { text: "Homework finish" },
        { text: "Pack folder" },
        { text: "Set shoes" },
      ],
    });
    await createResponsibility(page.request, {
      title: kitchenTitle,
      daypart: "evening",
      steps: [{ text: "Wipe counters" }, { text: "Load dishwasher" }],
    });
    await createRoutine(page.request, {
      title: bedtimeTitle,
      daypart: "bedtime",
      steps: [{ text: "Pajamas" }, { text: "Lights out" }],
    });

    const childContext = await browser.newContext();
    const child = await childContext.newPage();
    await claimAvery(child.request);
    const meta = await sessionMeta(child.request);
    const averyName = meta.member?.displayName ?? "Avery Reed";
    const today = meta.householdDate;
    const generation = meta.activityGeneration ?? 0;

    const occurrences = await fetchTodayOccurrences(child.request, today);
    const morning = occurrences.find((o) => o.title === morningTitle);
    const after = occurrences.find((o) => o.title === afterTitle);
    expect(morning, "morning occurrence").toBeTruthy();
    expect(after, "after school occurrence").toBeTruthy();

    await completeSteps(
      child.request,
      morning!,
      morning!.steps.map((s) => s.id),
      generation,
    );
    // Leave After school unfinished with some steps done (in progress → Next).
    await completeSteps(
      child.request,
      after!,
      after!.steps.slice(0, 2).map((s) => s.id),
      generation,
    );

    await child.goto("/");
    await expectSignedInAs(child, averyName);
    await expect(child.getByRole("heading", { name: "Today", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    await addPersonalTask(child, personalTitle, "private");

    const completedToggle = child.locator(".today-section-completed .today-section-toggle");
    await expect(completedToggle).toBeVisible({ timeout: 15_000 });
    await expect(completedToggle).toHaveAttribute("aria-expanded", "false");
    await expect(completedToggle.getByRole("heading", { name: "Completed" })).toBeVisible();

    await expect(child.getByRole("heading", { name: "Next", exact: true })).toBeVisible();
    const afterCard = child.locator(".occurrence").filter({ hasText: afterTitle });
    await expect(afterCard).toHaveAttribute("data-expanded", "true", { timeout: 15_000 });

    await expect(child.getByRole("heading", { name: "Later", exact: true })).toBeVisible();
    const kitchenCard = child.locator(".occurrence").filter({ hasText: kitchenTitle });
    const bedtimeCard = child.locator(".occurrence").filter({ hasText: bedtimeTitle });
    await expect(kitchenCard).toBeVisible({ timeout: 15_000 });
    await expect(bedtimeCard).toBeVisible({ timeout: 15_000 });
    await expect(kitchenCard).toHaveAttribute("data-expanded", "false");
    await expect(bedtimeCard).toHaveAttribute("data-expanded", "false");

    await expect(child.getByRole("heading", { name: "Anytime Today" })).toBeVisible();
    await expect(child.getByText(personalTitle)).toBeVisible();

    await expect(child.locator('.occurrence[data-expanded="true"]')).toHaveCount(1);

    await kitchenCard.getByRole("button").first().click();
    await expect(kitchenCard).toHaveAttribute("data-expanded", "true", { timeout: 15_000 });
    await expect(afterCard).toHaveAttribute("data-expanded", "false");
    await expect(child.locator('.occurrence[data-expanded="true"]')).toHaveCount(1);

    await kitchenCard.getByRole("button", { name: /Mark Wipe counters completed/i }).click();
    await expect(
      kitchenCard.getByTestId(/step-status-/).filter({ hasText: /Completed/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    await kitchenCard.getByRole("button").first().click();
    await expect(kitchenCard).toHaveAttribute("data-expanded", "false", { timeout: 15_000 });
    await expect(child.locator('.occurrence[data-expanded="true"]')).toHaveCount(0);

    await childContext.close();
  });

  test("AT2: all recurring complete → no Next; personal/anytime remain", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(
      testInfo.project.name === "chromium-desktop",
      "Phone Chromium/WebKit own this journey",
    );
    const suffix = Date.now().toString(36);
    const morningTitle = `C1 Done Morning ${suffix}`;
    const anytimeTitle = `C1 Anytime chore ${suffix}`;
    const personalTitle = `C1 Solo note ${suffix}`;

    await ensureManagerRequest(page.request);
    await createRoutine(page.request, {
      title: morningTitle,
      daypart: "morning",
      steps: [{ text: "Done step" }],
    });
    await createResponsibility(page.request, {
      title: anytimeTitle,
      daypart: "anytime",
      steps: [{ text: "Anytime step" }],
    });

    const childContext = await browser.newContext();
    const child = await childContext.newPage();
    await claimAvery(child.request);
    const meta = await sessionMeta(child.request);
    const averyName = meta.member?.displayName ?? "Avery Reed";
    const today = meta.householdDate;
    const generation = meta.activityGeneration ?? 0;

    // Complete every unfinished Avery occurrence so shared e2e DB leftovers cannot keep Next alive.
    const occurrences = await fetchTodayOccurrences(child.request, today);
    for (const occurrence of occurrences.filter((item) => !item.completed)) {
      await completeSteps(
        child.request,
        occurrence,
        occurrence.steps.filter((step) => step.status !== "completed").map((step) => step.id),
        generation,
      );
    }

    await child.goto("/");
    await expectSignedInAs(child, averyName);
    await addPersonalTask(child, personalTitle, "private");

    await expect(child.getByRole("heading", { name: "Next", exact: true })).toHaveCount(0);
    await expect(child.getByRole("heading", { name: "Anytime Today" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(child.getByText(personalTitle)).toBeVisible();
    const completedToggle = child.locator(".today-section-completed .today-section-toggle");
    await expect(completedToggle).toBeVisible({ timeout: 15_000 });
    await expect(completedToggle).toHaveAttribute("aria-expanded", "false");

    await childContext.close();
  });
});
