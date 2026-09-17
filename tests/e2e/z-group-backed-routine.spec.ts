import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const MORGAN_ID = "22222222-2222-4222-8222-222222222201";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const JORDAN_ID = "22222222-2222-4222-8222-222222222203";

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

async function ensureSharedRoutine(request: APIRequestContext) {
  const listed = await request.get("/api/v1/routines");
  expect(listed.ok()).toBeTruthy();
  const body = (await listed.json()) as { routines: Array<{ id: string }> };
  if (body.routines[0]) return body.routines[0];
  const created = await request.post("/api/v1/routines", {
    headers: {
      "x-csrf-token": await csrf(request),
      Origin: requestOrigin(request),
    },
    data: {
      mutationId: crypto.randomUUID(),
      title: "Morning Routine",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [MORGAN_ID, AVERY_ID, JORDAN_ID],
      assigneeGroupIds: [],
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Pack lunch", obligation: "as_needed" },
        { text: "Stretch", obligation: "optional" },
      ],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return ((await created.json()) as { routine: { id: string } }).routine;
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  await ensureSharedRoutine(page.request);
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

async function nextFreeRevisionDate(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const today = ((await session.json()) as { householdDate: string }).householdDate;
  const listed = await request.get("/api/v1/routines");
  expect(listed.ok()).toBeTruthy();
  const routines = ((await listed.json()) as { routines: Routine[] }).routines;
  const routine = routines[0] ?? null;
  const used = new Set(routine?.revisions.map((revision) => revision.effectiveDate) ?? []);
  let candidate = addDays(today, 1);
  while (used.has(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

type Routine = {
  id: string;
  revisions: Array<{
    effectiveDate: string;
    title: string;
    weekdays: number[];
    assigneeMemberIds: string[];
    assigneeGroupIds: string[];
    steps: Array<{ text: string; obligation: string; logicalItemId?: string }>;
  }>;
};

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

test.describe("P0-004B group-backed Morning Routine", () => {
  test("open Routine and group views converge after membership and source changes", async ({
    browser,
  }) => {
    const managerA = await browser.newContext();
    const managerB = await browser.newContext();
    const pageA = await managerA.newPage();
    const pageB = await managerB.newPage();
    await pageA.setViewportSize({ width: 390, height: 844 });
    await pageB.setViewportSize({ width: 390, height: 844 });

    await openAsManager(pageA);
    await openAsManager(pageB);

    const suffix = Date.now().toString(36);
    const childName = `Sync Child ${suffix}`;
    const groupName = `Sync Crew ${suffix}`;

    await openPeopleGroups(pageA);
    await pageA.getByRole("button", { name: "Add person" }).click();
    await pageA.getByRole("textbox", { name: "Name" }).fill(childName);
    await pageA.getByRole("radio", { name: "Child" }).check();
    await pageA.getByRole("button", { name: "Add person" }).click();
    await expect(pageA.getByRole("heading", { name: childName })).toBeVisible();
    await pageA.getByRole("button", { name: "Back to People & Groups" }).click();

    await pageA.getByRole("button", { name: "Create group" }).click();
    await pageA.getByLabel("Group name").fill(groupName);
    await pageA.getByRole("checkbox", { name: childName }).first().check();
    await pageA.getByRole("button", { name: "Save group" }).click();
    await expect(pageA.getByRole("heading", { name: groupName })).toBeVisible();
    await expect(pageA.getByText("Used by Morning Routine")).toHaveCount(0);

    await pageB.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(pageB.getByRole("heading", { name: "Routines" })).toBeVisible();
    await pageB.getByRole("button", { name: /Morning Routine/ }).first().click();
    await expect(pageB.getByRole("heading", { name: "Morning Routine" })).toBeVisible();

    // Routine-source update while group detail stays open: assign via API on a free date,
    // then prove the open group view converges without reload.
    const groups = await pageB.request.get("/api/v1/groups");
    expect(groups.ok()).toBeTruthy();
    const groupId = (
      (await groups.json()) as { groups: Array<{ id: string; name: string }> }
    ).groups.find((group) => group.name === groupName)!.id;
    const listed = await pageB.request.get("/api/v1/routines");
    const routine = ((await listed.json()) as { routines: Routine[] }).routines[0]!;
    const latest = routine.revisions.at(-1)!;
    const revised = await pageB.request.post(`/api/v1/routines/${routine.id}/revisions`, {
      headers: {
        "x-csrf-token": await csrf(pageB.request),
        Origin: requestOrigin(pageB.request),
      },
      data: {
        mutationId: crypto.randomUUID(),
        mode: "schedule",
        effectiveDate: await nextFreeRevisionDate(pageB.request),
        title: latest.title,
        daypart: "morning",
        weekdays: latest.weekdays,
        assigneeMemberIds: latest.assigneeMemberIds,
        assigneeGroupIds: [...new Set([...(latest.assigneeGroupIds ?? []), groupId])],
        steps: latest.steps.map((step) => ({
          text: step.text,
          obligation: step.obligation,
          logicalItemId: step.logicalItemId,
        })),
      },
    });
    expect(revised.ok(), await revised.text()).toBeTruthy();

    await expect(pageA.getByText("Used by Morning Routine")).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText(groupName).first()).toBeVisible({ timeout: 15_000 });

    await pageA.getByRole("button", { name: "Edit group" }).click();
    await pageA.getByRole("checkbox", { name: "Morgan Reed" }).check();
    await pageA.getByRole("button", { name: "Save group" }).click();
    await expect(
      pageA.getByText(/Morning Routine will use the new members starting/i),
    ).toBeVisible({ timeout: 10_000 });

    // Upcoming schedule entry and/or pending group membership should surface a Starting date.
    await expect(pageB.getByText(/Starting \d{4}-\d{2}-\d{2}/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(pageB.getByText(new RegExp(groupName, "i")).first()).toBeVisible();

    await managerA.close();
    await managerB.close();
  });

  test("phone journey configures The Boys and shows used-group feedback", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);

    await openPeopleGroups(page);

    for (const name of ["Daniel Boyd", "Eli Boyd"]) {
      await page.getByRole("button", { name: "Add person" }).click();
      await page.getByRole("textbox", { name: "Name" }).fill(name);
      await page.getByRole("radio", { name: "Child" }).check();
      await page.getByRole("button", { name: "Add person" }).click();
      await expect(page.getByRole("heading", { name })).toBeVisible();
      await page.getByRole("button", { name: "Back to People & Groups" }).click();
    }

    await page.getByRole("button", { name: "Create group" }).click();
    await page.getByLabel("Group name").fill("The Boys");
    await page.getByRole("checkbox", { name: "Daniel Boyd" }).first().check();
    await page.getByRole("checkbox", { name: "Eli Boyd" }).first().check();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByRole("heading", { name: "The Boys" })).toBeVisible();
    await page.getByRole("button", { name: "Back to People & Groups" }).click();

    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible();
    await page.getByRole("button", { name: /Morning Routine/ }).click();
    await expect(page.getByRole("heading", { name: "Morning Routine" })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit routine" })).toBeVisible();

    await page.getByRole("button", { name: /^Who/ }).click();
    await expect(page.getByRole("heading", { name: "Who does this routine?" })).toBeVisible();

    // Clear prior direct assignees from earlier e2e suites, then select only The Boys.
    const peopleBox = page.getByRole("group", { name: "People" });
    const groupsBox = page.getByRole("group", { name: "Groups" });
    for (const checkbox of await groupsBox.getByRole("checkbox").all()) {
      if (await checkbox.isChecked()) await checkbox.uncheck();
    }
    for (const checkbox of await peopleBox.getByRole("checkbox").all()) {
      if ((await checkbox.isChecked()) && !(await checkbox.isDisabled())) {
        await checkbox.uncheck();
      }
    }
    await groupsBox.getByRole("checkbox", { name: /The Boys/ }).check();
    // Re-clear any leftover directs after group selection.
    for (const checkbox of await peopleBox.getByRole("checkbox").all()) {
      if ((await checkbox.isChecked()) && !(await checkbox.isDisabled())) {
        await checkbox.uncheck();
      }
    }
    const boysRow = groupsBox.locator("label").filter({ hasText: "The Boys" });
    await expect(boysRow.getByText(/Daniel Boyd/)).toBeVisible();
    await expect(boysRow.getByText(/Eli Boyd/)).toBeVisible();
    await expect(boysRow.getByText(/one routine per member/i)).toBeVisible();
    await page.getByRole("button", { name: "Apply who does this" }).click();
    await expect(page.getByRole("heading", { name: "Edit routine" })).toBeVisible();
    await expect(page.getByText("The Boys").first()).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Morning Routine" })).toBeVisible({
      timeout: 15_000,
    });
    // r2 same-day refine: audience is active today (not only a future Starting line).
    await expect(page.getByText("The Boys").first()).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /The Boys/ })).toHaveCount(0);

    await openPeopleGroups(page);
    await page.getByRole("button", { name: /The Boys/ }).click();
    await expect(page.getByText("Used by Morning Routine")).toBeVisible();

    await page.getByRole("button", { name: "Edit group" }).click();
    await expect(page.getByText("Used by Morning Routine")).toBeVisible();
    await page.getByRole("checkbox", { name: "Morgan Reed" }).check();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByText(/Morning Routine will use the new members starting/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
