import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  expectSignedInAs,
  fillFocusedRoutineCreate,
  openRoutineSection,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const SCREENSHOT_DIR = path.resolve("reports/p0-006a-r2-screenshots");

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

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  await page.goto("/");
  await expectSignedInAs(page, "Morgan Reed");
}

async function assertNoHorizontalClip(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(false);
}

async function assertPrimaryActionsReachable(page: Page) {
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).or(page.getByRole("heading", { level: 2 })).first()).toBeVisible();
}

test.describe("P0-006A geometry and text scale", () => {
  test("360x800, 768x1024, and 200% text keep detail/editor/Today usable", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "webkit",
      "Geometry matrix runs on Chromium projects (phone + desktop entry)",
    );

    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    const title = `Geom ${Date.now().toString(36)}`;
    await fillFocusedRoutineCreate(page, {
      title,
      daypart: "morning",
      audienceName: "Morgan Reed",
      stepText: "Geometry step one with a longer label for wrapping",
    });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    // Add enough steps for density wrapping checks.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openRoutineSection(page, "Steps");
    for (const label of ["Second wrap check", "Third wrap check", "Fourth wrap check", "Fifth wrap check"]) {
      await page.getByRole("button", { name: "Add step", exact: true }).click();
      await page.locator("[data-ordered-row]").last().locator(".ordered-row-body button").click();
      await page.getByRole("textbox", { name: "Step text" }).fill(label);
      await page.getByRole("button", { name: "Done", exact: true }).click();
    }
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Saved/i })).toBeVisible({
      timeout: 15_000,
    });

    const geometries: Array<{ name: string; width: number; height: number }> = [
      { name: "360x800", width: 360, height: 800 },
      { name: "768x1024", width: 768, height: 1024 },
    ];

    for (const geo of geometries) {
      await page.setViewportSize({ width: geo.width, height: geo.height });
      await assertNoHorizontalClip(page);
      await assertPrimaryActionsReachable(page);
      await expect(page.getByRole("navigation", { name: "Primary" }).first()).toBeVisible();

      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Edit routine" })).toBeVisible();
      await assertNoHorizontalClip(page);
      await openRoutineSection(page, "Steps");
      await expect(page.getByRole("heading", { name: /steps/i })).toBeVisible();
      await assertNoHorizontalClip(page);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: /Back to/i }).first().click();

      await page.getByRole("button", { name: "Today", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
      await assertNoHorizontalClip(page);

      await page.getByRole("button", { name: "Plan", exact: true }).click();
      await page.getByRole("button", { name: new RegExp(title) }).first().click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();

      if (testInfo.project.name === "chromium") {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        await durableScreenshot(
          page,
          path.join(SCREENSHOT_DIR, `chromium-geometry-${geo.name}.png`),
        );
      }
    }

    // 200% text on representative detail + editor + Today (390×844 phone baseline).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addStyleTag({
      content: "html { font-size: 200% !important; }",
    });
    await assertNoHorizontalClip(page);
    await assertPrimaryActionsReachable(page);
    await expect(page.locator(".compact-step-list")).toBeVisible();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit routine" })).toBeVisible();
    await assertNoHorizontalClip(page);
    await page.getByRole("button", { name: /Back to/i }).first().click();

    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await assertNoHorizontalClip(page);

    if (testInfo.project.name === "chromium") {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "chromium-text-200.png"));
    }
  });
});
