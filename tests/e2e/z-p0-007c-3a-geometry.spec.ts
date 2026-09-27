import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const SCREENSHOT_DIR = path.resolve("reports/_local-screenshots/p0-007c-3a-r1");

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

async function mutatingHeaders(
  request: APIRequestContext,
): Promise<Record<string, string>> {
  return {
    "x-csrf-token": await csrf(request),
    Origin: requestOrigin(),
  };
}

async function ensureManagerSession(request: APIRequestContext) {
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

async function openEnrolledDisplay(page: Page, request: APIRequestContext): Promise<string> {
  await ensureManagerSession(request);
  const create = await request.post("/api/v1/displays", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      label: `Geo3A ${Date.now().toString(36)}`,
    },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const code = ((await create.json()) as { enrollment: { code: string } })
    .enrollment.code;

  const title = `Geo kitchen ${Date.now().toString(36)}`;
  await request.post("/api/v1/responsibilities", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title,
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: AVERY_ID,
      steps: [
        {
          logicalItemId: crypto.randomUUID(),
          text: "Counters",
          obligation: "required",
        },
        {
          logicalItemId: crypto.randomUUID(),
          text: "Wipe",
          obligation: "as_needed",
        },
      ],
    },
  });
  await request.post("/api/v1/auth/logout", {
    headers: await mutatingHeaders(request),
  });
  await page.context().clearCookies();

  await page.goto("/display");
  await expect(page.getByTestId("display-setup")).toBeVisible();
  await page.getByTestId("display-claim-code").fill(code);
  await page.getByRole("button", { name: "Connect display" }).click();
  await expect(page.getByTestId("display-overview")).toBeVisible({
    timeout: 20_000,
  });
  return title;
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
  expect(overflow).toBe(false);
}

test.describe("P0-007C-3A geometry", () => {
  test("AT12: 4K checklist controls visible and touch-sized", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "webkit",
      "Wall geometry coverage runs on Chromium desktop/display projects",
    );
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const isNative4k = testInfo.project.name === "chromium-display";
    const isPhone = testInfo.project.name === "chromium";

    if (isPhone) {
      // Phone project still greps this title; assert manager enrollment chrome.
      await ensureManagerSession(page.request);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto("/household/displays");
      await expect(
        page.getByRole("heading", { name: "Household displays" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Add display" })).toBeVisible();
      return;
    }

    if (isNative4k) {
      await page.setViewportSize({ width: 3840, height: 2160 });
    } else {
      await page.setViewportSize({ width: 1920, height: 1080 });
    }

    const workTitle = await openEnrolledDisplay(page, page.request);
    await assertNoHorizontalOverflow(page);

    await page.getByTestId("display-org-by-work").click();
    const workRow = page
      .getByTestId("display-by-work")
      .locator("button.display-work-row")
      .filter({ hasText: workTitle });
    await expect(workRow).toBeVisible({ timeout: 20_000 });
    await workRow.click();
    await expect(page.getByTestId("display-detail")).toBeVisible();

    const done = page.locator("[data-testid^=display-step-done-]").first();
    await expect(done).toBeVisible({ timeout: 20_000 });
    const box = await done.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

    await done.focus();
    await expect(done).toBeFocused();

    const notNeeded = page.locator("[data-testid^=display-step-not-needed-]");
    if (await notNeeded.count()) {
      const nnBox = await notNeeded.first().boundingBox();
      expect(nnBox?.height ?? 0).toBeGreaterThanOrEqual(48);
    }

    await assertNoHorizontalOverflow(page);
    await durableScreenshot(
      page,
      path.join(
        SCREENSHOT_DIR,
        isNative4k ? "checklist-controls-3840.png" : "checklist-controls-1920.png",
      ),
    );
  });
});
