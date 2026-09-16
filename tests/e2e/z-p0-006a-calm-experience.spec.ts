import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
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

test.describe("P0-006A calm household experience", () => {
  test("Plan nav, URL reload, dirty discard, and keyboard Move reorder", async ({
    page,
  }, testInfo) => {
    await openAsManager(page);

    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(page).toHaveURL(/\/plan$/);
    await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible();

    const title = `Calm Plan ${Date.now().toString(36)}`;
    await fillFocusedRoutineCreate(page, {
      title,
      daypart: "evening",
      audienceName: "Morgan Reed",
      stepText: "Step one",
    });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/plan\/routines\//);

    const detailUrl = page.url();
    await page.reload();
    await expectSignedInAs(page, "Morgan Reed");
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    expect(page.url()).toBe(detailUrl);

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openRoutineSection(page, "Name");
    await page.getByRole("textbox", { name: "Name" }).fill(`${title} dirty`);
    // Leave section dirty via Cancel (section only), then dirty outer draft via Done path:
    await page.getByRole("button", { name: "Done", exact: true }).click();

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toMatch(/unsaved changes/i);
      void dialog.dismiss(); // Keep editing
    });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit routine" })).toBeVisible();

    page.once("dialog", (dialog) => {
      void dialog.accept(); // Discard
    });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(title) }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("heading", { name: `${title} dirty` })).toHaveCount(0);

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openRoutineSection(page, "Steps");
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    await page.locator("[data-ordered-row]").nth(1).locator(".ordered-row-body button").click();
    await page.getByRole("textbox", { name: "Step text" }).fill("Step two");
    await page.getByRole("button", { name: "Done", exact: true }).click();

    const secondRow = page.locator("[data-ordered-row]").nth(1);
    await secondRow.getByRole("button", { name: /More actions/i }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect(page.locator("[data-ordered-row]").first()).toContainText("Step two");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Saved/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".compact-step-list")).toContainText("Step two");

    if (testInfo.project.name === "chromium" || testInfo.project.name === "chromium-desktop") {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      await durableScreenshot(
        page,
        path.join(SCREENSHOT_DIR, `${testInfo.project.name}-detail.png`),
      );
    }

    // Touchscreen drag is environment-dependent; attempt when hasTouch is available.
    if (testInfo.project.use.hasTouch) {
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await openRoutineSection(page, "Steps");
      const handle = page.locator("[data-ordered-row]").first().locator(".drag-handle");
      const box = await handle.boundingBox();
      if (box) {
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      }
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  });
});
