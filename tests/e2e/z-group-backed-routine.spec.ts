import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const MORGAN_ID = "22222222-2222-4222-8222-222222222201";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const JORDAN_ID = "22222222-2222-4222-8222-222222222203";
const SCREENSHOT_DIR = path.resolve("reports/p0-004b-r1-screenshots");

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
  const body = (await listed.json()) as { routine: { id: string } | null };
  if (body.routine) return body.routine;
  const created = await request.post("/api/v1/routines", {
    headers: {
      "x-csrf-token": await csrf(request),
      Origin: requestOrigin(request),
    },
    data: {
      mutationId: crypto.randomUUID(),
      title: "Morning Routine",
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
  await expect(page.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
}

test.describe("P0-004B group-backed Morning Routine", () => {
  test("phone journey configures The Boys and shows used-group feedback", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    await page.getByRole("button", { name: "People & Groups" }).click();

    for (const name of ["Daniel Boyd", "Eli Boyd"]) {
      await page.getByRole("button", { name: "Add person" }).click();
      await page.getByLabel("Name").fill(name);
      await page.getByRole("radio", { name: "Child" }).check();
      await page.getByRole("button", { name: "Add person" }).click();
      await expect(page.getByRole("heading", { name })).toBeVisible();
      await page.getByRole("button", { name: "Back to People & Groups" }).click();
    }

    await page.getByRole("button", { name: "Create group" }).click();
    await page.getByLabel("Group name").fill("The Boys");
    await page.getByRole("checkbox", { name: "Daniel Boyd" }).check();
    await page.getByRole("checkbox", { name: "Eli Boyd" }).check();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByRole("heading", { name: "The Boys" })).toBeVisible();
    await page.getByRole("button", { name: "Back to People & Groups" }).click();

    await page.getByRole("button", { name: "Routine" }).click();
    await expect(page.getByRole("heading", { name: "Who does this routine?" })).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "01-compact-summary.png"),
        fullPage: true,
      });
    }

    await page.getByRole("button", { name: /Add people or groups|Edit people or groups/ }).click();
    await expect(page.getByRole("heading", { name: "Who does this routine?" })).toBeVisible();

    // Clear prior direct assignees from earlier e2e suites, then select only The Boys.
    const peopleBox = page.locator("fieldset").filter({ hasText: "People" });
    for (const checkbox of await peopleBox.getByRole("checkbox").all()) {
      if ((await checkbox.isChecked()) && !(await checkbox.isDisabled())) {
        await checkbox.uncheck();
      }
    }
    const groupsBox = page.locator("fieldset").filter({ hasText: "Groups" });
    for (const checkbox of await groupsBox.getByRole("checkbox").all()) {
      if (await checkbox.isChecked()) await checkbox.uncheck();
    }
    await groupsBox.getByRole("checkbox", { name: /The Boys/ }).check();
    const boysRow = groupsBox.locator("label").filter({ hasText: "The Boys" });
    await expect(boysRow.getByText(/Daniel Boyd/)).toBeVisible();
    await expect(boysRow.getByText(/Eli Boyd/)).toBeVisible();
    await expect(boysRow.getByText(/one routine per member/i)).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "02-focused-picker.png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Save who does this" }).click();
    await expect(page.getByRole("heading", { name: "Who does this routine?" })).toBeVisible();
    await expect(page.getByText("The Boys").first()).toBeVisible();
    await expect(page.getByText(/2 people unique/i)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /The Boys/ })).toHaveCount(0);
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "03-selected-group-summary.png"),
        fullPage: true,
      });
    }

    await page.getByRole("button", { name: "People & Groups" }).click();
    await page.getByRole("button", { name: /The Boys/ }).click();
    await expect(page.getByText("Used by Morning Routine")).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "04-used-group-detail.png"),
        fullPage: true,
      });
    }

    await page.getByRole("button", { name: "Edit group" }).click();
    await expect(page.getByText("Used by Morning Routine")).toBeVisible();
    await page.getByRole("checkbox", { name: "Morgan Reed" }).check();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByText(/Morning Routine will use the new members starting/i)).toBeVisible({
      timeout: 10_000,
    });
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "05-pending-next-day.png"),
        fullPage: true,
      });
    }
  });
});
