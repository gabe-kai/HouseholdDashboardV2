import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

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
  startedAt?: string | null;
  state?: string;
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
  status: "completed" | "not_needed" | "open" = "completed",
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

/** Complete every assigned occurrence except the kept title(s). */
export async function completeOtherOccurrences(
  page: Page,
  membershipId: string,
  keepTitle: string | string[],
) {
  const keep = new Set(Array.isArray(keepTitle) ? keepTitle : [keepTitle]);
  const personDay = await fetchPersonDay(page, membershipId);
  for (const occurrence of personDay.occurrences) {
    if (keep.has(occurrence.title) || !occurrence.intendedStructure) continue;
    for (const step of occurrence.steps) {
      if (step.status !== "open") continue;
      const status = step.obligation === "as_needed" ? "not_needed" : "completed";
      await completeDisplayStep(page, occurrence, step.id, status);
    }
  }
}

export async function waitForReadyPanes(page: Page, membershipIds: readonly string[]) {
  for (const id of membershipIds) {
    await expect(page.getByTestId(`family-pane-${id}`)).toHaveAttribute("data-phase", "ready", {
      timeout: 20_000,
    });
  }
}

export async function clickFamilyControl(
  root: { getByTestId: (testId: string) => Locator },
  testId: string,
) {
  const locator = root.getByTestId(testId);
  await locator.click({ timeout: 20_000 });
}

export async function assertVisibleInClippingAncestors(locator: Locator) {
  await expect(locator).toBeVisible();
  const clipped = await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return "degenerate";
    if (rect.top < 0 || rect.left < 0 || rect.right > innerWidth || rect.bottom > innerHeight) {
      return "viewport";
    }
    let parent = node.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      const ox = style.overflowX;
      const oy = style.overflowY;
      if (/(auto|scroll|hidden)/.test(`${ox} ${oy}`)) {
        const box = parent.getBoundingClientRect();
        const visible = rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5 &&
          rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5;
        if (!visible) {
          const name = parent.getAttribute("data-testid") ?? parent.className ?? parent.tagName;
          return `${name} el=${JSON.stringify({ t: rect.top, b: rect.bottom, l: rect.left, r: rect.right })} clip=${JSON.stringify({ t: box.top, b: box.bottom, l: box.left, r: box.right })}`;
        }
      }
      parent = parent.parentElement;
    }
    return null;
  });
  expect(clipped, `clipped by ${clipped}`).toBeNull();
}

export async function assertNonOverlappingHits(root: Locator | Page, min = 48) {
  const hits = root.locator(".family-board-hit");
  const boxes = await hits.evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const box = (node as HTMLElement).getBoundingClientRect();
        if (box.width < 8 || box.height < 8) return null;
        let parent = node.parentElement;
        let top = Math.max(0, box.top);
        let bottom = Math.min(innerHeight, box.bottom);
        let left = Math.max(0, box.left);
        let right = Math.min(innerWidth, box.right);
        while (parent) {
          const style = getComputedStyle(parent);
          if (/(auto|scroll|hidden)/.test(`${style.overflowX} ${style.overflowY}`)) {
            const clip = parent.getBoundingClientRect();
            top = Math.max(top, clip.top);
            left = Math.max(left, clip.left);
            bottom = Math.min(bottom, clip.bottom);
            right = Math.min(right, clip.right);
          }
          parent = parent.parentElement;
        }
        const w = right - left;
        const h = bottom - top;
        if (w < 8 || h < 8) return null;
        return { x: left, y: top, w, h, minEdge: Math.min(w, h) };
      })
      .filter((box): box is NonNullable<typeof box> => box !== null),
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.minEdge).toBeGreaterThanOrEqual(min);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap =
        a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1;
      expect(overlap, `hit ${i} overlaps ${j}`).toBe(false);
    }
  }
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
