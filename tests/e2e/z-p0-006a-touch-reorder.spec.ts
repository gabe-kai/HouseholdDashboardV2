import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  expectSignedInAs,
  fillFocusedRoutineCreate,
  openRoutineSection,
} from "../helpers/e2e-shell";
import { touchDragByCdp, touchDragCancelByEscape } from "../helpers/touch-drag";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const SCREENSHOT_DIR = path.resolve("test-results/runtime-screenshots/p0-006a-r2");

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

async function centerOf(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing bounding box for touch target");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function rowLabels(page: Page): Promise<string[]> {
  return page.locator("[data-ordered-row] .ordered-row-body").allTextContents();
}

test.describe("P0-006A touch drag reorder", () => {
  test("touch drag persists order, Escape cancels, and edge autoscrolls", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "CDP touch dispatch is exercised on the Chromium phone project only",
    );
    test.skip(!testInfo.project.use.hasTouch, "Requires a touch-capable project");

    await openAsManager(page);
    await page.getByRole("button", { name: "Plan", exact: true }).click();

    const title = `Touch Drag ${Date.now().toString(36)}`;
    await fillFocusedRoutineCreate(page, {
      title,
      daypart: "evening",
      audienceName: "Morgan Reed",
      stepText: "Alpha step",
    });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await openRoutineSection(page, "Steps");

    // Build a long list so the ordered container must scroll near edges.
    for (const label of [
      "Bravo step",
      "Charlie step",
      "Delta step",
      "Echo step",
      "Foxtrot step",
      "Golf step",
      "Hotel step",
      "India step",
      "Juliet step",
    ]) {
      await page.getByRole("button", { name: "Add step", exact: true }).click();
      await page.locator("[data-ordered-row]").last().locator(".ordered-row-body button").click();
      await page.getByRole("textbox", { name: "Step text" }).fill(label);
      await page.getByRole("button", { name: "Done", exact: true }).click();
    }

    const list = page.locator(".ordered-list-rows");
    await expect(list).toBeVisible();
    const before = await rowLabels(page);
    expect(before[0]).toContain("Alpha step");
    expect(before.at(-1)).toContain("Juliet step");

    // --- Escape cancel: move then restore ---
    const firstHandle = page.locator("[data-ordered-row]").first().locator(".drag-handle");
    const thirdRow = page.locator("[data-ordered-row]").nth(2);
    const from = await centerOf(firstHandle);
    const mid = await centerOf(thirdRow);
    await touchDragCancelByEscape(page, from, mid);
    await expect.poll(async () => (await rowLabels(page))[0]).toContain("Alpha step");

    // --- Edge autoscroll while dragging ---
    await list.evaluate((node) => {
      node.scrollTop = 0;
    });
    const scrollBefore = await list.evaluate((node) => node.scrollTop);
    const listBox = await list.boundingBox();
    if (!listBox) throw new Error("ordered list missing box");
    const handleStart = await centerOf(
      page.locator("[data-ordered-row]").first().locator(".drag-handle"),
    );
    // Hold near the bottom edge (within OrderedList's 48px autoscroll band) and inch downward.
    const edgeY = listBox.y + listBox.height - 24;
    await touchDragByCdp(
      page,
      handleStart,
      { x: handleStart.x, y: edgeY },
      { steps: 20, pauseMs: 30 },
    );
    const scrollAfter = await list.evaluate((node) => node.scrollTop);
    expect(scrollAfter).toBeGreaterThan(scrollBefore);

    // --- Persist reorder via touch drag to the end ---
    await list.evaluate((node) => {
      node.scrollTop = 0;
    });
    const labelsBeforePersist = await rowLabels(page);
    const startHandle = page.locator("[data-ordered-row]").first().locator(".drag-handle");
    const lastRow = page.locator("[data-ordered-row]").last();
    await touchDragByCdp(page, await centerOf(startHandle), await centerOf(lastRow), {
      steps: 24,
      pauseMs: 20,
    });
    await expect
      .poll(async () => (await rowLabels(page)).at(-1) ?? "")
      .toContain(labelsBeforePersist[0]!.trim().slice(0, 10));

    const persistedFirst = (await rowLabels(page))[0]!;
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Saved/i })).toBeVisible({
      timeout: 15_000,
    });

    // Detail compact list reflects new order after save + reload.
    await expect(page.locator(".compact-step-list li").first()).toContainText(
      persistedFirst.replace(/\s+Required\s*$/i, "").trim().slice(0, 8),
      { timeout: 10_000 },
    );
    await page.reload();
    await expectSignedInAs(page, "Morgan Reed");
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".compact-step-list li").first()).toContainText(
      persistedFirst.replace(/\s+Required\s*$/i, "").trim().slice(0, 8),
    );

    if (testInfo.project.name === "chromium") {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      await durableScreenshot(page, path.join(SCREENSHOT_DIR, "chromium-touch-reorder.png"));
    }
  });
});
