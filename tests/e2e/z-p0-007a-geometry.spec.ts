import { test, expect, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import { expectSignedInAs, fillFocusedResponsibilityCreate } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
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

/**
 * Authenticated geometry checks for P0-007A (AT14).
 * Phone Chromium journeys own fuller product coverage; desktop asserts key controls.
 */
test.describe("P0-007A authenticated geometry", () => {
  test("authenticated Plan/History controls visible at 360 and 1280", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "webkit",
      "Geometry coverage runs on Chromium projects",
    );
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await ensureManagerSession(page.request);
    await page.goto("/");
    await expectSignedInAs(page, "Morgan Reed");

    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add responsibility/i })).toBeVisible();

    const title = `Geo ${Date.now().toString(36)}`;
    await fillFocusedResponsibilityCreate(page, {
      title,
      weekdaysPreset: "every",
      daypart: "anytime",
      ownerName: "Avery",
      stepTexts: ["Feed"],
    });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "11-geometry-plan-360.png"));
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("button", { name: "Plan", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Household", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Household", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^History/i })
      .click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    if (testInfo.project.name === "chromium-desktop" || testInfo.project.name === "chromium") {
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "12-geometry-history-1280.png"));
    }
  });
});
