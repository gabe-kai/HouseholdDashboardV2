import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";
import { clickFamilyControl, completeOtherOccurrences, fetchPersonDay, PEOPLE } from "../helpers/p0-009b";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";

function requestOrigin(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
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

async function csrfHeaders(request: APIRequestContext) {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const csrfToken = ((await session.json()) as { csrfToken: string }).csrfToken;
  return { "x-csrf-token": csrfToken, Origin: requestOrigin() };
}

async function enrollWall(request: APIRequestContext, wall: Page, label: string) {
  await ensureManagerSession(request);
  const create = await request.post("/api/v1/displays", {
    headers: await csrfHeaders(request),
    data: { mutationId: crypto.randomUUID(), label },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const body = (await create.json()) as {
    display: { id: string };
    enrollment: { code: string };
  };
  await wall.goto("/display");
  await wall.getByTestId("display-claim-code").fill(body.enrollment.code);
  await wall.getByRole("button", { name: "Connect display" }).click();
  await expect(wall.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
  return body.display.id;
}

test.describe("P0-009B family wall preview", () => {
  test("AT11b/AT11c: preview pane expiry follows its last successful snapshot", async ({ page }) => {
    await page.addInitScript(() => {
      window.__HD_PREVIEW_STALE_MS = 2000;
      window.__HD_PREVIEW_POLL_MS = 60_000;
      window.__HD_PREVIEW_NOW_MS = 10_000;
    });
    await ensureManagerSession(page.request);
    const created = await page.request.post("/api/v1/displays", {
      headers: await csrfHeaders(page.request),
      data: { mutationId: crypto.randomUUID(), label: `Preview lease ${Date.now()}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const displayId = ((await created.json()) as { display: { id: string } }).display.id;
    const path = `**/api/v1/displays/${displayId}/preview/people/${AVERY_ID}/day`;
    const old = await page.request.get(`/api/v1/displays/${displayId}/preview/people/${AVERY_ID}/day`);
    expect(old.ok()).toBeTruthy();
    const oldBody = await old.text();
    await page.goto(`/household/displays/${displayId}/preview`);
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    for (const person of PEOPLE) {
      await expect(frame.getByTestId(`family-pane-${person.id}`)).toHaveAttribute("data-phase", "ready", { timeout: 20_000 });
    }
    // Drain the initial Strict Mode/dashboard loads before advancing the clock.
    await page.waitForTimeout(500);
    let capturedResolve = () => undefined as void;
    const captured = new Promise<void>((resolve) => { capturedResolve = resolve; });
    let releaseResolve = () => undefined as void;
    const held = new Promise<void>((resolve) => { releaseResolve = resolve; });
    let deliveredResolve = () => undefined as void;
    const delivered = new Promise<void>((resolve) => { deliveredResolve = resolve; });
    let heldCount = 0;
    let deliveredCount = 0;
    let releaseFresh = () => undefined as void;
    const freshHold = new Promise<void>((resolve) => { releaseFresh = resolve; });
    await page.route(path, async (route) => {
      heldCount += 1;
      if (heldCount > 2) {
        await freshHold;
        await route.continue();
        return;
      }
      capturedResolve();
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: oldBody });
      deliveredCount += 1;
      deliveredResolve();
    });
    const sibling = "22222222-2222-4222-8222-222222222203";
    const siblingRefresh = page.waitForResponse((response) => response.url().includes(`/preview/people/${sibling}/day`) && response.ok());
    await page.evaluate(() => { window.__HD_PREVIEW_NOW_MS = 11_000; document.dispatchEvent(new Event("visibilitychange")); });
    await captured;
    await siblingRefresh;
    // Let the accepted sibling response reach the preview frame before the
    // next generation of refreshes is queued.
    await page.waitForTimeout(250);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => heldCount).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => { window.__HD_PREVIEW_NOW_MS = 12_001; });
    await expect(frame.getByTestId(`family-blank-${AVERY_ID}`)).toBeVisible({ timeout: 10_000 });
    await expect(frame.getByTestId(`family-pane-${sibling}`)).toHaveAttribute("data-phase", "ready");
    releaseResolve();
    await delivered;
    await expect.poll(() => deliveredCount).toBeGreaterThanOrEqual(2);
    await expect(frame.getByTestId(`family-blank-${AVERY_ID}`)).toBeVisible();
    releaseFresh();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(frame.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready", { timeout: 20_000 });
    await page.unrouteAll({ behavior: "wait" });
  });

  test("AT14d: a missing person stays local while a revoked selected display clears preview", async ({ page }) => {
    await page.addInitScript(() => { window.__HD_PREVIEW_POLL_MS = 500; });
    await ensureManagerSession(page.request);
    const created = await page.request.post("/api/v1/displays", {
      headers: await csrfHeaders(page.request),
      data: { mutationId: crypto.randomUUID(), label: `Revocation ${Date.now()}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const display = ((await created.json()) as { display: { id: string; configVersion: number } }).display;
    const path = `**/api/v1/displays/${display.id}/preview/people/${AVERY_ID}/day`;
    await page.goto(`/household/displays/${display.id}/preview`);
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready", { timeout: 20_000 });
    await page.route(path, (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "NOT_FOUND" }) }));
    await expect(frame.getByTestId(`family-unavailable-${AVERY_ID}`)).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByTestId("family-board")).toBeVisible();
    await page.unroute(path);
    await expect(frame.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready", { timeout: 20_000 });
    let capturedResolve = () => undefined as void;
    const captured = new Promise<void>((resolve) => { capturedResolve = resolve; });
    let releaseResolve = () => undefined as void;
    const held = new Promise<void>((resolve) => { releaseResolve = resolve; });
    let deliveredResolve = () => undefined as void;
    const delivered = new Promise<void>((resolve) => { deliveredResolve = resolve; });
    await page.route(path, async (route) => {
      capturedResolve();
      await held;
      await route.continue();
      deliveredResolve();
    });
    await captured;
    const list = await page.request.get("/api/v1/displays");
    expect(list.ok()).toBeTruthy();
    const selected = ((await list.json()) as { displays: Array<{ id: string; configVersion: number }> })
      .displays.find((row) => row.id === display.id);
    expect(selected).toBeTruthy();
    const revoke = await page.request.post(`/api/v1/displays/${display.id}/revoke`, {
      headers: await csrfHeaders(page.request),
      data: { mutationId: crypto.randomUUID(), expectedConfigVersion: selected!.configVersion },
    });
    expect(revoke.ok(), await revoke.text()).toBeTruthy();
    await expect(frame.getByTestId("family-board")).toHaveCount(0, { timeout: 20_000 });
    releaseResolve();
    await delivered;
    await expect(frame.getByTestId("family-board")).toHaveCount(0);
  });

  test("AT13c: withdrawn promotion can return without an older held day restoring it", async ({ page }) => {
    await page.addInitScript(() => { window.__HD_PREVIEW_POLL_MS = 500; });
    await ensureManagerSession(page.request);
    const title = `Promotion ${Date.now().toString(36)}`;
    const createdTask = await page.request.post("/api/v1/personal-tasks", {
      headers: await csrfHeaders(page.request),
      data: { title, visibility: "household", showOnSharedDashboard: true },
    });
    expect(createdTask.ok(), await createdTask.text()).toBeTruthy();
    const task = (await createdTask.json()) as { task: { id: string; sharingVersion: number } };
    const display = await page.request.post("/api/v1/displays", {
      headers: await csrfHeaders(page.request),
      data: { mutationId: crypto.randomUUID(), label: `Promotion ${Date.now()}` },
    });
    expect(display.ok(), await display.text()).toBeTruthy();
    const displayId = ((await display.json()) as { display: { id: string } }).display.id;
    const managerId = "22222222-2222-4222-8222-222222222201";
    const path = `/api/v1/displays/${displayId}/preview/people/${managerId}/day`;
    const old = await page.request.get(path);
    expect(old.ok()).toBeTruthy();
    const oldBody = await old.text();
    await page.goto(`/household/displays/${displayId}/preview`);
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByText(title)).toBeVisible({ timeout: 20_000 });
    let capturedResolve = () => undefined as void;
    const captured = new Promise<void>((resolve) => { capturedResolve = resolve; });
    let releaseResolve = () => undefined as void;
    const held = new Promise<void>((resolve) => { releaseResolve = resolve; });
    let deliveredResolve = () => undefined as void;
    const delivered = new Promise<void>((resolve) => { deliveredResolve = resolve; });
    let first = true;
    await page.route(`**${path}`, async (route) => {
      if (!first) return route.continue();
      first = false;
      capturedResolve();
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: oldBody });
      deliveredResolve();
    });
    await captured;
    const withdraw = await page.request.post(`/api/v1/personal-tasks/${task.task.id}/sharing`, {
      headers: await csrfHeaders(page.request),
      data: { mutationId: crypto.randomUUID(), visibility: "private", showOnSharedDashboard: false, expectedSharingVersion: task.task.sharingVersion },
    });
    expect(withdraw.ok(), await withdraw.text()).toBeTruthy();
    await expect(frame.getByText(title)).toHaveCount(0, { timeout: 20_000 });
    releaseResolve();
    await delivered;
    await expect(frame.getByText(title)).toHaveCount(0);
    const changed = (await withdraw.json()) as { task: { sharingVersion: number } };
    const promote = await page.request.post(`/api/v1/personal-tasks/${task.task.id}/sharing`, {
      headers: await csrfHeaders(page.request),
      data: { mutationId: crypto.randomUUID(), visibility: "household", showOnSharedDashboard: true, expectedSharingVersion: changed.task.sharingVersion },
    });
    expect(promote.ok(), await promote.text()).toBeTruthy();
    await expect(frame.getByText(title)).toBeVisible({ timeout: 20_000 });
  });

  test("AT19a/AT19b/AT19c: preview board is readonly and does not steer the wall", async ({
    page,
    browser,
  }) => {
    await page.addInitScript(() => {
      const topWindow = window.top as (Window & { __displayOutboxAttempts?: string[] }) | null;
      if (!topWindow) return;
      topWindow.__displayOutboxAttempts ??= [];
      const record = (key: unknown) => {
        if (typeof key === "string" && key.startsWith("hd-display-outbox-v1:")) {
          topWindow.__displayOutboxAttempts?.push(key);
        }
      };
      const store = IDBObjectStore.prototype;
      const get = store.get;
      const put = store.put;
      const remove = store.delete;
      store.get = function (key) { record(key); return get.call(this, key); };
      store.put = function (value, key) { record(key); return put.call(this, value, key); };
      store.delete = function (key) { record(key); return remove.call(this, key); };
    });
    await ensureManagerSession(page.request);
    const title = `Preview ${Date.now().toString(36)}`;
    await page.request.post("/api/v1/routines", {
      headers: await csrfHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title,
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [AVERY_ID],
        assigneeGroupIds: [],
        steps: [{ logicalItemId: crypto.randomUUID(), text: "Hold this step", obligation: "required" }],
      },
    });
    const wallContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const wall = await wallContext.newPage();
    const displayId = await enrollWall(page.request, wall, `Preview wall ${Date.now().toString(36)}`);
    await completeOtherOccurrences(wall, AVERY_ID, title);
    await wall.reload();
    await expect(wall.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready");
    const nativeGeometry: Record<number, { width: number; height: number; left: number; top: number }> = {};
    for (const width of [1920, 3840]) {
      await wall.setViewportSize({ width, height: width * 9 / 16 });
      nativeGeometry[width] = await wall.getByTestId(`family-pane-${AVERY_ID}`).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
      });
    }
    await wall.setViewportSize({ width: 1920, height: 1080 });
    let releaseWrite = () => undefined as void;
    const heldWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const wallWrites: string[] = [];
    await wall.route("**/api/v1/display/occurrences/**/status", async (route) => {
      wallWrites.push((route.request().postDataJSON() as { mutationId: string }).mutationId);
      await heldWrite;
      await route.continue();
    });
    const wallDone = wall.getByTestId(`family-pane-${AVERY_ID}`).getByRole("button", { name: "Mark Hold this step done" });
    await wallDone.click();
    await expect(wall.getByTestId(`family-pending-${AVERY_ID}`)).toBeVisible();
    await clickFamilyControl(wall, `family-upcoming-${AVERY_ID}`);
    await expect(wall.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "upcoming");
    const wallNames = await wall.locator(".family-board-pane .display-person-name").allTextContents();
    expect(wallNames.length).toBeGreaterThan(0);

    const displayRequests: string[] = [];
    await page.goto("/household/displays");
    await expectSignedInAs(page, "Morgan Reed");
    page.on("request", (req) => {
      if (new URL(req.url()).pathname.startsWith("/api/v1/display/")) displayRequests.push(`${req.method()} ${new URL(req.url()).pathname}`);
    });
    const preview = page.getByTestId(`display-preview-${displayId}`);
    await preview.click();
    await expect(page.getByTestId("display-preview-only")).toBeVisible();
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready", {
      timeout: 20_000,
    });
    await expect(frame.locator("[data-testid^='display-step-done-']")).toHaveCount(0);
    await page.getByRole("button", { name: "1920 × 1080" }).click();
    await expect(page.getByTestId("display-preview-geometry")).toContainText("1920 × 1080");
    await expect(frame.getByTestId("family-board")).toBeVisible();
    const names1920 = await frame.locator(".family-board-pane .display-person-name").allTextContents();
    expect(names1920.slice(0, wallNames.length)).toEqual(wallNames);
    async function compareGeometry(width: number) {
      const measured = await frame.getByTestId(`family-pane-${AVERY_ID}`).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, top: rect.top };
      });
      const native = nativeGeometry[width]!;
      for (const key of ["width", "height", "left", "top"] as const) {
        expect(Math.abs(measured[key] - native[key]), `${width} ${key}`).toBeLessThan(width * 0.05);
      }
      return measured;
    }
    await compareGeometry(1920);
    await page.getByRole("button", { name: "3840 × 2160" }).click();
    await expect(page.getByTestId("display-preview-geometry")).toContainText("3840 × 2160");
    await expect(frame.getByTestId("family-board")).toBeVisible();
    const names3840 = await frame.locator(".family-board-pane .display-person-name").allTextContents();
    expect(names3840.slice(0, wallNames.length)).toEqual(wallNames);
    const geometry3840 = await compareGeometry(3840);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(frame.getByTestId("family-board")).toBeVisible();
    const namesResized = await frame
      .locator(".family-board-pane .display-person-name")
      .allTextContents();
    expect(namesResized.slice(0, wallNames.length)).toEqual(wallNames);
    const resizedGeometry = await compareGeometry(3840);
    expect(resizedGeometry).toEqual(geometry3840);
    await clickFamilyControl(frame, `family-enlarge-${AVERY_ID}`);
    await expect(frame.getByTestId(`family-back-${AVERY_ID}`)).toBeVisible();
    expect(displayRequests).toEqual([]);
    expect(await page.evaluate(() => (window as Window & { __displayOutboxAttempts?: string[] }).__displayOutboxAttempts)).toEqual([]);
    await expect(wall.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "upcoming");
    await expect(wall.getByTestId(`family-pending-${AVERY_ID}`)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("display-preview-only")).toBeVisible();
    const reloaded = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(reloaded.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    await expect(reloaded.locator("[data-testid^='display-step-done-']")).toHaveCount(0);
    await expect(wall.getByTestId(`family-pending-${AVERY_ID}`)).toBeVisible();
    releaseWrite();
    await expect(wall.getByTestId(`family-pending-${AVERY_ID}`)).toHaveCount(0, { timeout: 20_000 });
    const settled = (await fetchPersonDay(wall, AVERY_ID)).occurrences.find((row) => row.title === title);
    expect(settled?.steps.find((step) => step.text === "Hold this step")?.status).toBe("completed");
    expect(wallWrites).toHaveLength(1);
    // A hard reload performs the app-wide credential-precedence probe before
    // mounting the member app; the preview itself makes no display calls.
    expect(displayRequests).toEqual(["GET /api/v1/display/session"]);
    expect(await page.evaluate(() => (window as Window & { __displayOutboxAttempts?: string[] }).__displayOutboxAttempts)).toEqual([]);
    const proof = await page.request.get("/family-board-proof.html");
    if (proof.ok()) {
      const proofText = await proof.text();
      expect(proofText).not.toContain("p0-009a-family-board-crowded-r2");
      expect(proofText).not.toMatch(/School|Meals|Calendar placeholder/i);
    } else {
      expect(proof.status()).toBe(404);
    }
    await wallContext.close();
    expect(displayId).toBeTruthy();
  });

  test("AT13a/AT19a: preview person-day omits private work and shows the shared board", async ({
    page,
  }) => {
    await ensureManagerSession(page.request);
    const stamp = Date.now().toString(36);
    const privateTitle = `PRIVATE-PREVIEW-${stamp}`;
    const visibleTitle = `UNPROMOTED-PREVIEW-${stamp}`;
    const privateTask = await page.request.post("/api/v1/personal-tasks", {
      headers: await csrfHeaders(page.request),
      data: { title: privateTitle, visibility: "private" },
    });
    const unpromoted = await page.request.post("/api/v1/personal-tasks", {
      headers: await csrfHeaders(page.request),
      data: { title: visibleTitle, visibility: "household", showOnSharedDashboard: false },
    });
    expect(privateTask.ok()).toBeTruthy();
    expect(unpromoted.ok()).toBeTruthy();
    const privateId = ((await privateTask.json()) as { task: { id: string } }).task.id;
    const unpromotedId = ((await unpromoted.json()) as { task: { id: string } }).task.id;
    const created = await page.request.post("/api/v1/displays", {
      headers: await csrfHeaders(page.request),
      data: { mutationId: crypto.randomUUID(), label: `Prev ${Date.now().toString(36)}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const displayId = ((await created.json()) as { display: { id: string } }).display.id;
    const managerId = "22222222-2222-4222-8222-222222222201";
    const previewDay = await page.request.get(`/api/v1/displays/${displayId}/preview/people/${managerId}/day`);
    expect(previewDay.ok()).toBeTruthy();
    const bodyText = await previewDay.text();
    for (const hidden of [privateTitle, visibleTitle, privateId, unpromotedId]) expect(bodyText).not.toContain(hidden);
    expect(bodyText).not.toMatch(/intendedStructure|logicalItemId|csrf/i);
    await page.goto(`/household/displays/${displayId}/preview`);
    await expect(page.getByTestId("display-preview-only")).toBeVisible();
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByTestId(`family-pane-${managerId}`)).toHaveAttribute("data-phase", "ready");
    const detailRequests: string[] = [];
    page.on("request", (req) => {
      const path = new URL(req.url()).pathname;
      if (path.endsWith(`/preview/people/${managerId}`)) detailRequests.push(path);
    });
    await clickFamilyControl(frame, `family-enlarge-${managerId}`);
    expect(detailRequests).toEqual([]);
    await expect(frame.getByText(visibleTitle)).toHaveCount(0);
    await clickFamilyControl(frame, `family-personal-${managerId}`);
    await expect(frame.getByTestId("display-detail")).toContainText(visibleTitle);
    expect(detailRequests.length).toBeGreaterThan(0);
    await expect(frame.getByTestId("display-detail").getByText(privateTitle)).toHaveCount(0);
    await expect(frame.getByTestId("display-detail").locator("[data-testid^='display-step-done-']")).toHaveCount(0);
  });
});
