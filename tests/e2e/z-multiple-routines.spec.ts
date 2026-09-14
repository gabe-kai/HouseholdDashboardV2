import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const SCREENSHOT_DIR = path.resolve("reports/p0-005-r1-screenshots");

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
  const token = await csrf(request);
  const created = await request.post("/api/v1/routines", {
    headers: { "x-csrf-token": token },
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
      headers: { "x-csrf-token": token },
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
  await expect(page.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
}

test.describe("P0-005 multiple household routines", () => {
  test("phone journey creates After School and Bedtime beside Morning", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    // Ensure Kids group exists for audience.
    await page.getByRole("button", { name: "People & Groups" }).click();
    const kidsExists = await page.getByRole("button", { name: /Kids/ }).count();
    if (kidsExists === 0) {
      await page.getByRole("button", { name: "Create group" }).click();
      await page.getByLabel("Group name").fill("Kids");
      for (const name of ["Avery Reed", "Jordan Reed"]) {
        const box = page.getByRole("checkbox", { name });
        if (await box.count()) await box.check();
      }
      await page.getByRole("button", { name: "Save group" }).click();
      await expect(page.getByRole("heading", { name: "Kids" })).toBeVisible();
      await page.getByRole("button", { name: "Back to People & Groups" }).click();
    }

    await page.getByRole("button", { name: "Routines", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Routines/i })).toBeVisible();
    await expect(page.getByText(/Morning Routine/i).first()).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "01-routines-list.png"),
        fullPage: true,
      });
    }

    // Create After School
    await page.getByRole("button", { name: /New routine/i }).click();
    await page.getByLabel("Name").fill("After School Routine");
    await page.getByLabel("Daypart").selectOption("after_school");
    await page.getByRole("button", { name: /Add people or groups|Edit people or groups/ }).click();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "02-audience-picker.png"),
        fullPage: true,
      });
    }
    const groupsBox = page.locator("fieldset").filter({ hasText: "Groups" });
    if (await groupsBox.getByRole("checkbox", { name: /Kids/ }).count()) {
      await groupsBox.getByRole("checkbox", { name: /Kids/ }).check();
    } else {
      await page
        .locator("fieldset")
        .filter({ hasText: "People" })
        .getByRole("checkbox", { name: /Avery Reed|Morgan Reed/ })
        .first()
        .check();
    }
    await page.getByRole("button", { name: /Save who does this|Apply who does this/i }).click();
    const stepInputs = page.locator(".step-editor input");
    await stepInputs.first().fill("Unpack bag");
    await page.getByRole("button", { name: /Add step/i }).click();
    await stepInputs.nth(1).fill("Start homework");
    await page.getByRole("button", { name: /Create routine|Save/i }).first().click();
    await expect(page.getByRole("heading", { name: /After School Routine/i })).toBeVisible({
      timeout: 15_000,
    });
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "03-after-school-detail.png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: /Back to Routines/i }).click();

    // Create Bedtime
    await page.getByRole("button", { name: /New routine/i }).click();
    await page.getByLabel("Name").fill("Bedtime");
    await page.getByLabel("Daypart").selectOption("bedtime");
    await page.getByRole("button", { name: /Add people or groups|Edit people or groups/ }).click();
    const groupsBox2 = page.locator("fieldset").filter({ hasText: "Groups" });
    if (await groupsBox2.getByRole("checkbox", { name: /Kids/ }).count()) {
      await groupsBox2.getByRole("checkbox", { name: /Kids/ }).check();
    } else {
      await page
        .locator("fieldset")
        .filter({ hasText: "People" })
        .getByRole("checkbox", { name: /Avery Reed|Morgan Reed/ })
        .first()
        .check();
    }
    await page.getByRole("button", { name: /Save who does this|Apply who does this/i }).click();
    await page.locator(".step-editor input").first().fill("Brush teeth");
    await page.getByRole("button", { name: /Create routine|Save/i }).first().click();
    await expect(page.getByRole("heading", { name: /^Bedtime$/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /Back to Routines/i }).click();
    await expect(page.getByRole("button", { name: /After School Routine/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bedtime/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Morning Routine/i })).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "04-routines-list-three.png"),
        fullPage: true,
      });
    }

    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByText(/After School|Bedtime|Morning/i).first()).toBeVisible({
      timeout: 15_000,
    });
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "05-today-multi.png"),
        fullPage: true,
      });
    }

    // Archive Bedtime (native confirm)
    await page.getByRole("button", { name: "Routines", exact: true }).click();
    await page.getByRole("button", { name: /^Bedtime/ }).first().click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Archive routine" }).click();
    await expect(page.getByText(/Archived/i).first()).toBeVisible({ timeout: 10_000 });
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "06-archived-detail.png"),
        fullPage: true,
      });
    }
  });
});
