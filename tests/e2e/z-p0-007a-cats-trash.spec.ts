import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  expectSignedInAs,
  fillFocusedResponsibilityCreate,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_LOGIN = "e2e.avery";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const SCREENSHOT_DIR = path.resolve("reports/p0-007a-r1-screenshots");

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

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  await page.goto("/");
  await expectSignedInAs(page, "Morgan Reed");
}

test.describe("P0-007A Cats and Trash foundation", () => {
  test("parent creates Cats and Trash; child completes Cats; oversight and History update", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      testInfo.project.name === "chromium-desktop",
      "Phone Chromium/WebKit own this journey",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const capture = testInfo.project.name === "chromium";

    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();

    await fillFocusedResponsibilityCreate(page, {
      title: "Cats",
      weekdaysPreset: "every",
      daypart: "anytime",
      ownerName: "Avery",
      stepTexts: ["Feed cats", "Refresh water"],
    });
    await expect(page.getByRole("heading", { name: "Cats" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Next 7 days" })).toBeVisible();
    await expect(page).toHaveURL(/\/plan\/responsibilities\//);
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "01-cats-detail.png"));
    }

    await page.getByRole("button", { name: /Back to Plan/i }).click();
    await fillFocusedResponsibilityCreate(page, {
      title: "Trash & Recycling",
      weekdaysPreset: "tuesday",
      daypart: "evening",
      ownerName: "Avery",
      stepTexts: ["Take out trash", "Set recycling"],
    });
    await expect(page.getByRole("heading", { name: "Trash & Recycling" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Evening/i).first()).toBeVisible();
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "02-trash-detail.png"));
    }

    const previewRows = page.locator(".responsibility-preview-list li");
    await expect(previewRows.first()).toBeVisible();
    const previewText = await previewRows.allTextContents();
    expect(previewText.some((line) => /No work/i.test(line))).toBeTruthy();

    const childContext = await browser.newContext();
    const child = await childContext.newPage();
    await claimAvery(child.request);
    const averySession = await child.request.get("/api/v1/auth/session");
    expect(averySession.ok()).toBeTruthy();
    const averyName =
      ((await averySession.json()) as { member?: { displayName?: string } }).member
        ?.displayName ?? "Avery Reed";
    await child.goto("/");
    await expectSignedInAs(child, averyName);
    const catsCard = child.locator(".occurrence").filter({ hasText: "Cats" });
    await expect(catsCard).toBeVisible({ timeout: 20_000 });
    if (capture) {
      await durableScreenshot(child, path.join(SCREENSHOT_DIR, "03-today-mixed.png"));
    }

    await catsCard.getByRole("button", { name: /Mark Feed cats completed/i }).click();
    await catsCard.getByRole("button", { name: /Mark Refresh water completed/i }).click();
    await expect(catsCard).toHaveAttribute("data-completed", "true", { timeout: 20_000 });

    await page.getByRole("button", { name: "Household", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /Household activity/i })
      .click();
    await expect(page.getByRole("heading", { name: "Household activity" })).toBeVisible();
    const catsRow = page.locator(".compact-activity-row").filter({ hasText: "Cats" });
    await expect(catsRow).toContainText(/Complete|In progress/i, { timeout: 20_000 });
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "04-household-activity.png"));
    }
    await catsRow.click();
    await expect(page.getByRole("heading", { name: "Cats" })).toBeVisible();
    await page.getByRole("button", { name: /Back to Household activity/i }).click();
    await page.getByRole("button", { name: /Back to Household/i }).click();

    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^History/i })
      .click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await page.getByRole("button", { name: /Filters/i }).click();
    await page.getByLabel("Work").selectOption("responsibility");
    await expect(page.getByRole("button", { name: /Cats/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    if (capture) {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "05-history-responsibilities.png"));
    }

    await childContext.close();
  });
});
