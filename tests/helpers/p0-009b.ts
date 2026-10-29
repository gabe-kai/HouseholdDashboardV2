import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

export const PASSPHRASE = "unique-passphrase-ok!";
export const MANAGER_LOGIN = "e2e.manager";
export const PEOPLE = [
  { id: "22222222-2222-4222-8222-222222222201", name: "Morgan Reed" },
  { id: "22222222-2222-4222-8222-222222222202", name: "Avery Reed" },
  { id: "22222222-2222-4222-8222-222222222203", name: "Jordan Reed" },
  { id: "22222222-2222-4222-8222-222222222204", name: "Casey Reed" },
  { id: "22222222-2222-4222-8222-222222222205", name: "Taylor Reed" },
  { id: "22222222-2222-4222-8222-222222222206", name: "Rowan Reed" },
] as const;
export const AVERY_ID = PEOPLE[1].id;
export const JORDAN_ID = PEOPLE[2].id;

export function requestOrigin(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
}

export async function ensureManagerSession(request: APIRequestContext) {
  const origin = requestOrigin();
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
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: MANAGER_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

export async function restoreSeedPeople(request: APIRequestContext) {
  await ensureManagerSession(request);
  const peopleRes = await request.get("/api/v1/people");
  expect(peopleRes.ok()).toBeTruthy();
  const body = (await peopleRes.json()) as {
    familyOrderVersion: number;
    people: Array<{
      id: string;
      displayName: string;
      version: number;
      classification: "adult" | "teen" | "child" | null;
    }>;
  };
  const extras = body.people
    .map((person) => person.id)
    .filter((id) => !PEOPLE.some((seed) => seed.id === id));
  const order = [...PEOPLE.map((person) => person.id), ...extras];
  const reorder = await request.put("/api/v1/people/order", {
    headers: await csrfHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      expectedVersion: body.familyOrderVersion,
      membershipIds: order,
    },
  });
  expect(reorder.ok(), await reorder.text()).toBeTruthy();
  for (const seed of PEOPLE) {
    const current = body.people.find((person) => person.id === seed.id);
    if (!current || current.displayName === seed.name) continue;
    const patched = await request.patch(`/api/v1/people/${seed.id}`, {
      headers: await csrfHeaders(request),
      data: {
        displayName: seed.name,
        classification: current.classification,
        expectedVersion: current.version,
      },
    });
    expect(patched.ok(), await patched.text()).toBeTruthy();
  }
}

export async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const csrfToken = ((await session.json()) as { csrfToken: string }).csrfToken;
  return { "x-csrf-token": csrfToken, Origin: requestOrigin() };
}

export async function householdDate(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { householdDate: string }).householdDate;
}

export async function enrollWall(managerRequest: APIRequestContext, wall: Page, label: string) {
  await restoreSeedPeople(managerRequest);
  await ensureManagerSession(managerRequest);
  const create = await managerRequest.post("/api/v1/displays", {
    headers: await csrfHeaders(managerRequest),
    data: { mutationId: crypto.randomUUID(), label },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const body = (await create.json()) as {
    display: { id: string; configVersion?: number };
    enrollment: { code: string };
  };
  await wall.goto("/display");
  await expect(wall.getByTestId("display-setup")).toBeVisible();
  await wall.getByTestId("display-claim-code").fill(body.enrollment.code);
  await wall.getByRole("button", { name: "Connect display" }).click();
  await expect(wall.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
  return body.display.id;
}

type PersonDayOccurrence = {
  id: string;
  title: string;
  kind: string;
  householdDate: string;
  intendedStructure?: unknown;
  steps: Array<{ id: string; text: string; status: string; obligation?: string }>;
};

export async function fetchPersonDay(page: Page, membershipId: string) {
  const day = await page.request.get(`/api/v1/display/people/${membershipId}/day`);
  expect(day.ok(), await day.text()).toBeTruthy();
  return (
    (await day.json()) as {
      personDay: { occurrences: PersonDayOccurrence[] };
    }
  ).personDay;
}

export async function completeDisplayStep(
  page: Page,
  occurrence: PersonDayOccurrence,
  stepId: string,
  status: "completed" | "not_needed" = "completed",
) {
  const session = await page.request.get("/api/v1/display/session");
  expect(session.ok()).toBeTruthy();
  const body = (await session.json()) as {
    session: { csrfToken: string; activityGeneration: number };
  };
  const csrf = body.session.csrfToken;
  expect(occurrence.intendedStructure).toBeTruthy();
  const posted = await page.request.post(
    `/api/v1/display/occurrences/${occurrence.id}/steps/${stepId}/status`,
    {
      headers: { Origin: requestOrigin(), "x-csrf-token": csrf },
      data: {
        mutationId: crypto.randomUUID(),
        status,
        performedAt: new Date().toISOString(),
        householdDate: occurrence.householdDate,
        kind: occurrence.kind,
        activityGeneration: body.session.activityGeneration,
        intendedStructure: occurrence.intendedStructure,
      },
    },
  );
  expect(posted.ok(), await posted.text()).toBeTruthy();
}

/** Complete the first open matching step so that occurrence becomes recommended next. */
export async function startOccurrenceByStepText(page: Page, membershipId: string, stepText: string) {
  const personDay = await fetchPersonDay(page, membershipId);
  for (const occurrence of personDay.occurrences) {
    const step = occurrence.steps.find((row) => row.text === stepText && row.status === "open");
    if (!step || !occurrence.intendedStructure) continue;
    await completeDisplayStep(page, occurrence, step.id);
    return occurrence;
  }
  throw new Error(`Open step "${stepText}" not found for ${membershipId}`);
}

/** Settle leftover assigned work so `keepStepText` can become the pane's next action. */
export async function completeOtherOpenSteps(page: Page, membershipId: string, keepStepText: string) {
  const personDay = await fetchPersonDay(page, membershipId);
  for (const occurrence of personDay.occurrences) {
    if (!occurrence.intendedStructure) continue;
    for (const step of occurrence.steps) {
      if (step.text === keepStepText || step.status !== "open") continue;
      const status = step.obligation === "as_needed" ? "not_needed" : "completed";
      await completeDisplayStep(page, occurrence, step.id, status);
    }
  }
}

/** Complete every assigned occurrence except the one with this title. */
export async function completeOtherOccurrences(page: Page, membershipId: string, keepTitle: string) {
  const personDay = await fetchPersonDay(page, membershipId);
  for (const occurrence of personDay.occurrences) {
    if (occurrence.title === keepTitle || !occurrence.intendedStructure) continue;
    for (const step of occurrence.steps) {
      if (step.status !== "open") continue;
      const status = step.obligation === "as_needed" ? "not_needed" : "completed";
      await completeDisplayStep(page, occurrence, step.id, status);
    }
  }
}

export async function clickFamilyControl(
  root: {
    getByTestId: (testId: string) => {
      waitFor: (options: { state: "attached"; timeout?: number }) => Promise<unknown>;
      evaluate: (fn: (node: HTMLElement) => void) => Promise<unknown>;
    };
  },
  testId: string,
) {
  const locator = root.getByTestId(testId);
  await locator.waitFor({ state: "attached", timeout: 20_000 });
  await locator.evaluate((node) => node.click());
}

export async function createAssignedRoutine(
  request: APIRequestContext,
  opts: {
    title: string;
    memberId: string;
    steps: Array<{ text: string; obligation?: "required" | "as_needed" | "optional" }>;
    daypart?: string;
  },
) {
  const created = await request.post("/api/v1/routines", {
    headers: await csrfHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title: opts.title,
      daypart: opts.daypart ?? "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [opts.memberId],
      assigneeGroupIds: [],
      steps: opts.steps.map((step) => ({
        logicalItemId: crypto.randomUUID(),
        text: step.text,
        obligation: step.obligation ?? "required",
      })),
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
}
