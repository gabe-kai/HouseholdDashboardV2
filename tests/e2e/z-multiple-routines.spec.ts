import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { durableScreenshot } from "../helpers/durable-screenshot";
import { expectSignedInAs, openRoutineSection } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
/** P0-006A: do not rewrite prior P0-005 screenshot evidence (AT12 zero-diff). */
const CAPTURE_LEGACY_R3_SCREENSHOTS = false;
const R3_SCREENSHOT_DIR = path.resolve("reports/p0-005-r3-screenshots");

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

async function ensureMorningRoutine(request: APIRequestContext) {
  const listed = await request.get("/api/v1/routines");
  expect(listed.ok()).toBeTruthy();
  const body = (await listed.json()) as {
    routines: Array<{ id: string; revisions: Array<{ title: string; daypart: string }> }>;
  };
  const hasMorning = body.routines.some((routine) =>
    routine.revisions.some((revision) => /morning/i.test(revision.title)),
  );
  if (hasMorning) return;
  const origin = requestOrigin(request);
  const token = await csrf(request);
  const created = await request.post("/api/v1/routines", {
    headers: { "x-csrf-token": token, Origin: origin },
    data: {
      mutationId: crypto.randomUUID(),
      title: "Morning Routine",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [],
      assigneeGroupIds: [],
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Brush teeth", obligation: "required" },
      ],
    },
  });
  // Audience may require at least one source — fall back to manager membership from people list.
  if (!created.ok()) {
    const people = await request.get("/api/v1/people");
    expect(people.ok()).toBeTruthy();
    const members = (await people.json()) as {
      people: Array<{ id: string; displayName: string }>;
    };
    const morgan = members.people.find((p) => /Morgan/i.test(p.displayName)) ?? members.people[0];
    expect(morgan).toBeTruthy();
    const retry = await request.post("/api/v1/routines", {
      headers: { "x-csrf-token": token, Origin: origin },
      data: {
        mutationId: crypto.randomUUID(),
        title: "Morning Routine",
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [morgan!.id],
        assigneeGroupIds: [],
        steps: [
          { text: "Make bed", obligation: "required" },
          { text: "Brush teeth", obligation: "required" },
        ],
      },
    });
    expect(retry.ok(), await retry.text()).toBeTruthy();
  }
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  await ensureMorningRoutine(page.request);
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

async function pickAudience(page: Page) {
  await page.getByRole("button", { name: /^Who/ }).click();
  const groupsBox = page.getByRole("group", { name: "Groups" });
  const peopleBox = page.getByRole("group", { name: "People" });
  if (await groupsBox.getByRole("checkbox", { name: /Kids/ }).count()) {
    await groupsBox.getByRole("checkbox", { name: /Kids/ }).first().check();
  } else {
    await peopleBox
      .getByRole("checkbox", { name: /Avery Reed|Morgan Reed/ })
      .first()
      .check();
  }
  await page.getByRole("button", { name: /Apply who does this/i }).click();
}

test.describe("P0-005 multiple household routines", () => {
  test("phone journey creates After School and Bedtime beside Morning", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);

    // Ensure Kids group exists for audience.
    await openPeopleGroups(page);
    const kidsListed =
      (await page.getByRole("button", { name: /^Kids\b/ }).count()) > 0 ||
      (await page.getByText(/\bKids\b/).count()) > 0;
    if (!kidsListed) {
      await page.getByRole("button", { name: "Create group" }).click();
      await page.getByLabel("Group name").fill("Kids");
      for (const name of ["Avery Reed", "Jordan Reed"]) {
        const box = page.getByRole("checkbox", { name });
        if (await box.count()) await box.check();
      }
      await page.getByRole("button", { name: "Save group" }).click();
      const created = page.getByRole("heading", { name: "Kids" });
      const conflict = page.getByRole("alert").filter({ hasText: /already exists/i });
      await expect(created.or(conflict)).toBeVisible({ timeout: 20_000 });
      if (await conflict.count()) {
        await page.getByRole("button", { name: "Back to People & Groups" }).click();
      } else {
        await expect(created).toBeVisible();
        await page.getByRole("button", { name: "Back to People & Groups" }).click();
      }
    }

    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Routines/i })).toBeVisible();
    await expect(page.getByText(/Morning Routine/i).first()).toBeVisible();
    if (CAPTURE_LEGACY_R3_SCREENSHOTS && testInfo.project.name === "chromium") {
      fs.mkdirSync(R3_SCREENSHOT_DIR, { recursive: true });
      await durableScreenshot(page, path.join(R3_SCREENSHOT_DIR, "01-routines-list.png"));
    }

    // Create After School
    await page.getByRole("button", { name: /Create routine/i }).click();
    await openRoutineSection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill("After School Routine");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await openRoutineSection(page, "When");
    await page.getByLabel("Daypart").selectOption("after_school");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await pickAudience(page);
    await openRoutineSection(page, "Steps");
    await page.locator("[data-ordered-row]").first().locator(".ordered-row-body button").click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Unpack bag");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: /Add step/i }).click();
    await page.locator("[data-ordered-row]").nth(1).locator(".ordered-row-body button").click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Start homework");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Create routine", exact: true }).click();
    await expect(page.getByRole("heading", { name: /After School Routine/i })).toBeVisible({
      timeout: 15_000,
    });
    if (CAPTURE_LEGACY_R3_SCREENSHOTS && testInfo.project.name === "chromium") {
      await durableScreenshot(page, path.join(R3_SCREENSHOT_DIR, "02-routine-detail.png"));
    }
    await page.getByRole("button", { name: /Back to Routines/i }).click();

    // Create Bedtime
    await page.getByRole("button", { name: /Create routine/i }).click();
    await openRoutineSection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill("Bedtime");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await openRoutineSection(page, "When");
    await page.getByLabel("Daypart").selectOption("bedtime");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await pickAudience(page);
    await openRoutineSection(page, "Steps");
    await page.locator("[data-ordered-row]").first().locator(".ordered-row-body button").click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Brush teeth");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Create routine", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Bedtime$/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /Back to Routines/i }).click();
    await expect(page.getByRole("button", { name: /After School Routine/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bedtime/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Morning Routine/i })).toBeVisible();

    // Today may list child occurrences for the manager (shared.manage). Reload to pick up sync.
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.reload();
    await expectSignedInAs(page, "Morgan Reed");
    await expect(
      page
        .getByText(/After School|Bedtime|Morning/i)
        .or(page.getByText(/No routines for you/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // End Bedtime via More (native confirm)
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: /^Bedtime/ }).first().click();
    await page.getByRole("button", { name: "More", exact: true }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("menuitem", { name: "End routine" }).click();
    await expect(page.getByText(/^Ended$/).or(page.getByText(/Ended Bedtime/i))).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /Back to Ended routines/i }).click();
    await expect(page.getByRole("heading", { name: "Ended routines" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bedtime/ })).toBeVisible();
    if (CAPTURE_LEGACY_R3_SCREENSHOTS && testInfo.project.name === "chromium") {
      await durableScreenshot(page, path.join(R3_SCREENSHOT_DIR, "04-ended-routines.png"));
    }
  });

  test("rename and step edits apply same-day for unstarted and stay discoverable", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);

    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: /Morning Routine|Morning Checklist/ }).first().click();
    await expect(page.getByRole("heading", { name: /Morning/i })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit routine" })).toBeVisible();

    const renamed = `Morning Checklist ${Date.now().toString(36)}`;
    await openRoutineSection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill(renamed);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await openRoutineSection(page, "Steps");
    await page
      .locator("[data-ordered-row]")
      .first()
      .locator(".ordered-row-body button")
      .click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Stretch quietly");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .locator("[data-ordered-row]")
      .nth(1)
      .locator(".ordered-row-body button")
      .click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Pack soft lunch");
    await page.getByLabel("Obligation").selectOption("optional");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("status").filter({ hasText: /^Saved/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Steps/ })).toBeVisible();
    await expect(page.locator(".compact-step-list").first()).toContainText("Stretch quietly");
    await expect(page.locator(".compact-step-list").first()).toContainText("Pack soft lunch");
    await expect(page.locator(".compact-step-list").first()).toContainText("Optional");

    await page.getByRole("button", { name: "Back to Routines" }).click();
    await expect(page.getByRole("button", { name: new RegExp(renamed) })).toBeVisible();
    if (CAPTURE_LEGACY_R3_SCREENSHOTS && testInfo.project.name === "chromium") {
      fs.mkdirSync(R3_SCREENSHOT_DIR, { recursive: true });
      await durableScreenshot(page, path.join(R3_SCREENSHOT_DIR, "05-same-day-edit-list.png"));
      await page.getByRole("button", { name: new RegExp(renamed) }).click();
      await durableScreenshot(page, path.join(R3_SCREENSHOT_DIR, "06-same-day-edit-detail.png"));
    }
  });
});
