import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const SCREENSHOT_DIR = path.resolve("reports/_local-screenshots/p0-007c-2-r1");

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

async function openEnrolledDisplay(page: Page, request: APIRequestContext) {
  await ensureManagerSession(request);
  const create = await request.post("/api/v1/displays", {
    headers: await mutatingHeaders(request),
    data: { mutationId: crypto.randomUUID(), label: `Geo ${Date.now().toString(36)}` },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const code = ((await create.json()) as { enrollment: { code: string } }).enrollment.code;

  // Claim must be signed-out of human session (409 otherwise).
  await request.post("/api/v1/auth/logout", {
    headers: await mutatingHeaders(request),
  });
  await page.context().clearCookies();

  await page.goto("/display");
  await expect(page.getByTestId("display-setup")).toBeVisible();
  await page.getByTestId("display-claim-code").fill(code);
  await page.getByRole("button", { name: "Connect display" }).click();
  await expect(page.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
  expect(overflow).toBe(false);
}

test.describe("P0-007C-2 geometry", () => {
  test("AT8: 4K and scaled wall typography/touch geometry", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === "webkit",
      "Wall geometry coverage runs on Chromium desktop/display projects",
    );
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const isNative4k = testInfo.project.name === "chromium-display";
    const isPhone = testInfo.project.name === "chromium";

    if (isPhone) {
      // Manager enrollment usable at phone width.
      await ensureManagerSession(page.request);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto("/household/displays");
      await expect(page.getByRole("heading", { name: "Household displays" })).toBeVisible();
      await expect(page.getByTestId("display-label-input")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add display" })).toBeVisible();
      const addButton = page.getByRole("button", { name: "Add display" });
      const box = await addButton.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(0);
      expect(box?.height ?? 0).toBeGreaterThan(0);
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "manager-displays-360.png"));
      return;
    }

    if (isNative4k) {
      await page.setViewportSize({ width: 3840, height: 2160 });
    } else {
      // 1920×1080 CSS @ device scale 2 (physical ~4K).
      await page.setViewportSize({ width: 1920, height: 1080 });
    }

    await openEnrolledDisplay(page, page.request);
    await assertNoHorizontalOverflow(page);

    const metrics = await page.evaluate(() => {
      const name = document.querySelector(".display-person-name");
      const time = document.querySelector(".display-time");
      const status = document.querySelector(".display-person-status");
      const touch = document.querySelector(".display-person-card");
      const style = (el: Element | null) =>
        el ? Number.parseFloat(getComputedStyle(el).fontSize) : 0;
      const touchBox = touch?.getBoundingClientRect();
      return {
        namePx: style(name),
        timePx: style(time),
        statusPx: style(status),
        touchH: touchBox?.height ?? 0,
        touchW: touchBox?.width ?? 0,
        people: document.querySelectorAll(
          '[data-testid="display-by-person"] .display-person-card',
        ).length,
      };
    });

    // Seed has six people; shared e2e DBs may accumulate extra memberships from other suites.
    expect(metrics.people).toBeGreaterThanOrEqual(6);
    expect(metrics.touchH).toBeGreaterThanOrEqual(48);
    expect(metrics.touchW).toBeGreaterThanOrEqual(48);

    if (isNative4k) {
      expect(metrics.namePx).toBeGreaterThanOrEqual(79.5);
      expect(metrics.timePx).toBeGreaterThanOrEqual(79.5);
      expect(metrics.statusPx).toBeGreaterThanOrEqual(47.5);

      const scroll = await page.evaluate(() => {
        const cards = [
          ...document.querySelectorAll(
            '[data-testid="display-by-person"] .display-person-card',
          ),
        ].slice(0, 6);
        const bottoms = cards.map((card) => card.getBoundingClientRect().bottom);
        const bottom = bottoms.length ? Math.max(...bottoms) : 0;
        return {
          sixCardBottom: bottom,
          viewportHeight: window.innerHeight,
          cardCount: cards.length,
        };
      });
      // Six-person resting overview fits the 4K viewport (no substantial scroll for that set).
      expect(scroll.cardCount).toBe(6);
      expect(scroll.sixCardBottom).toBeLessThanOrEqual(scroll.viewportHeight + 48);

      await page.getByTestId("display-org-by-work").focus();
      await expect(page.getByTestId("display-org-by-work")).toBeFocused();
      const personCard = page.getByTestId("display-by-person").locator("button").first();
      await personCard.focus();
      await expect(personCard).toBeFocused();

      // 200% text zoom remains usable (no horizontal overflow).
      await page.evaluate(() => {
        document.documentElement.style.zoom = "2";
      });
      await assertNoHorizontalOverflow(page);
      await page.evaluate(() => {
        document.documentElement.style.zoom = "1";
      });

      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "by-person-3840.png"));
    } else {
      // Proportional scale at 1920 CSS (~half of 4K floors).
      expect(metrics.namePx).toBeGreaterThanOrEqual(39.5);
      expect(metrics.statusPx).toBeGreaterThanOrEqual(23.5);
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "by-person-1920.png"));
    }

    await page.getByTestId("display-org-by-work").click();
    await expect(page.getByTestId("display-by-work")).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await durableScreenshot(
      page,
      path.join(
        SCREENSHOT_DIR,
        isNative4k ? "by-work-3840.png" : "by-work-1920.png",
      ),
    );

    await page.getByTestId("display-org-by-person").click();
    await page.getByTestId("display-by-person").locator("button").first().click();
    await expect(page.getByTestId("display-detail")).toBeVisible();
    await durableScreenshot(
      page,
      path.join(
        SCREENSHOT_DIR,
        isNative4k ? "detail-3840.png" : "detail-1920.png",
      ),
    );
  });
});
