import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Route,
} from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const AVERY_LOGIN = "e2e.avery";

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
  expect(boot.status()).toBe(409);
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: MANAGER_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const csrfToken = ((await session.json()) as { csrfToken: string }).csrfToken;
  return { "x-csrf-token": csrfToken, Origin: requestOrigin() };
}

async function enrollWall(
  managerRequest: APIRequestContext,
  wall: Page,
  label: string,
): Promise<{ displayId: string; code: string }> {
  await ensureManagerSession(managerRequest);
  const create = await managerRequest.post("/api/v1/displays", {
    headers: await csrfHeaders(managerRequest),
    data: { mutationId: crypto.randomUUID(), label },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const body = (await create.json()) as {
    display: { id: string };
    enrollment: { code: string };
  };
  await wall.goto("/display");
  await expect(wall.getByTestId("display-setup")).toBeVisible();
  await wall.getByTestId("display-claim-code").fill(body.enrollment.code);
  await wall.getByRole("button", { name: "Connect display" }).click();
  await expect(wall.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
  return { displayId: body.display.id, code: body.enrollment.code };
}

async function createAveryRoutine(request: APIRequestContext, title: string, stepText: string) {
  const created = await request.post("/api/v1/routines", {
    headers: await csrfHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title,
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [AVERY_ID],
      assigneeGroupIds: [],
      steps: [{ logicalItemId: crypto.randomUUID(), text: stepText, obligation: "required" }],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return created.json() as Promise<{ routine: { id: string; version: number } }>;
}

async function createPreviewDisplay(page: Page, label: string) {
  await ensureManagerSession(page.request);
  await page.goto("/household/displays");
  await expectSignedInAs(page, "Morgan Reed");
  await expect(page.getByTestId("household-displays")).toBeVisible();
  await page.getByTestId("display-label-input").fill(label);
  await page.getByRole("button", { name: "Add display" }).click();
  await expect(page.getByTestId("display-code-panel")).toBeVisible();
  const preview = page.getByRole("button", { name: "Preview display" }).first();
  await expect(preview).toBeVisible();
  return preview;
}

type HeldPreview = {
  captured: Promise<void>;
  release: (mutate?: (body: string) => string) => Promise<void>;
};

async function armHeldPreview(page: Page, glob: string, snapshot: string): Promise<HeldPreview> {
  let capturedResolve: () => void = () => undefined;
  const captured = new Promise<void>((resolve) => {
    capturedResolve = resolve;
  });
  let mutateBody: ((body: string) => string) | undefined;
  let releaseResolve: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    releaseResolve = resolve;
  });
  let armed = true;
  await page.route(glob, async (route: Route) => {
    if (!armed) {
      await route.continue();
      return;
    }
    armed = false;
    capturedResolve();
    await released;
    const body = mutateBody ? mutateBody(snapshot) : snapshot;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body,
    });
  });
  return {
    captured,
    release: async (mutate) => {
      mutateBody = mutate;
      releaseResolve();
    },
  };
}

async function postPreviewBack(page: Page) {
  const child = page.frame({ url: /preview-frame\.html/ });
  if (!child) throw new Error("preview frame missing");
  await child.evaluate(() => {
    window.parent.postMessage({ type: "hd-preview-back" }, window.location.origin);
  });
}

test.describe("P0-009A selected-display preview", () => {
  test("AT3b/AT6a/AT7b: preview opens read-only, restores by URL, and Back returns", async ({
    page,
  }) => {
    const label = `Preview ${Date.now().toString(36)}`;
    const previewButton = await createPreviewDisplay(page, label);
    await previewButton.click();
    await expect(page.getByTestId("display-preview-host")).toBeVisible();
    await expect(page.getByTestId("display-preview-only")).toContainText(
      "Preview only — changes cannot be made here",
    );
    await expect(page).toHaveURL(/\/household\/displays\/.+\/preview/);
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByTestId("display-org-by-person")).toBeVisible();
    await frame.getByTestId("display-org-by-work").click();
    await expect(frame.getByTestId("display-by-work")).toBeVisible();
    await expect(frame.getByTestId("display-step-done-x")).toHaveCount(0);

    const previewUrl = page.url();
    await page.reload();
    await expect(page.getByTestId("display-preview-host")).toBeVisible();
    await expect(page).toHaveURL(previewUrl);

    await page.getByRole("button", { name: "Back to displays" }).click();
    await expect(page.getByTestId("household-displays")).toBeVisible();
    await expect(page).toHaveURL(/\/household\/displays$/);
  });

  test("AT6a signed-out restore: preview path is remembered through sign-in", async ({
    page,
    context,
  }) => {
    const label = `Restore ${Date.now().toString(36)}`;
    await createPreviewDisplay(page, label);
    await page.getByRole("button", { name: "Preview display" }).first().click();
    await expect(page.getByTestId("display-preview-host")).toBeVisible();
    const previewPath = new URL(page.url()).pathname;

    await context.clearCookies();
    await page.goto(previewPath);
    await page.getByLabel("Login name").fill(MANAGER_LOGIN);
    await page.getByLabel("Passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("display-preview-host")).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe(previewPath);
  });

  test("AT8b built absence: production client does not serve the proof entry", async ({
    request,
  }) => {
    const proof = await request.get("/family-board-proof.html");
    const body = await proof.text();
    expect(body).not.toContain("Family board proof");
    expect(body).not.toContain("p0-009a-family-board-crowded-r2");
    expect(body).not.toContain("family-board-proof.tsx");
    const distProof = "dist/client/family-board-proof.html";
    const { existsSync } = await import("node:fs");
    expect(existsSync(distProof)).toBe(false);
  });

  test("AT3b: preview browse does not steer a wall with a pending intent", async ({
    page,
    browser,
  }) => {
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    const enrolled = await enrollWall(page.request, wall, `Steer ${Date.now().toString(36)}`);
    const pendingTitle = `Pending stretch ${Date.now().toString(36)}`;
    await createAveryRoutine(page.request, pendingTitle, "Hold this step");
    await wall.reload();
    await expect(wall.getByTestId("display-overview")).toBeVisible();
    await wall.getByTestId("display-org-by-person").click();
    await wall
      .getByTestId("display-by-person")
      .locator(".display-person-card")
      .filter({ hasText: /Avery/i })
      .click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();
    await wall
      .getByTestId("display-detail")
      .locator("button.display-work-row")
      .filter({ hasText: pendingTitle })
      .click();
    await expect(wall.getByText("Hold this step")).toBeVisible();
    const wallScroll = await wall.evaluate(() => document.scrollingElement?.scrollTop ?? 0);

    await wall.route("**/api/v1/display/occurrences/**/status", (route: Route) => route.abort());
    const done = wall.locator("[data-testid^=display-step-done-]").first();
    await expect(done).toBeVisible();
    await done.click();
    await expect(wall.getByRole("status").filter({ hasText: /pending|Saving|retry/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.goto(`/household/displays/${enrolled.displayId}/preview`);
    await expect(page.getByTestId("display-preview-host")).toBeVisible();
    const previewFrame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(previewFrame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await previewFrame.getByTestId("display-org-by-work").click();
    await expect(previewFrame.getByTestId("display-by-work")).toBeVisible();
    await expect(previewFrame.locator("[data-testid^=display-step-done-]")).toHaveCount(0);
    const previewMutations: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/v1/display")) {
        previewMutations.push(request.url());
      }
    });
    await previewFrame.getByTestId("display-org-by-person").click();
    expect(previewMutations).toEqual([]);

    await expect(wall.getByTestId("display-detail")).toBeVisible();
    await expect(wall.getByText("Hold this step")).toBeVisible();
    const wallScrollAfter = await wall.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    expect(wallScrollAfter).toBe(wallScroll);
    await expect(wall.getByRole("status").filter({ hasText: /pending|Saving|retry/i }).first()).toBeVisible();

    await wall.unroute("**/api/v1/display/occurrences/**/status");
    await wall.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(
      wall.locator("[data-testid^=display-step-done-]").first(),
    ).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(wall.getByRole("status").filter({ hasText: /pending|Saving|retry/i })).toHaveCount(
      0,
    );
    await expect(wall.getByTestId("display-pending-cue")).toHaveCount(0);
    await expect(wall.getByText("Hold this step")).toBeVisible();
    await expect(previewFrame.locator("[data-testid^=display-step-done-]")).toHaveCount(0);
    await wallCtx.close();
  });

  test("AT5a: second context updates open preview detail; gone work becomes unavailable", async ({
    page,
    browser,
  }) => {
    await page.addInitScript(() => {
      window.__HD_PREVIEW_POLL_MS = 800;
    });
    const label = `Live ${Date.now().toString(36)}`;
    const previewButton = await createPreviewDisplay(page, label);
    const stepText = `Preview live ${Date.now().toString(36)}`;
    const routineTitle = `Live routine ${Date.now().toString(36)}`;
    await createAveryRoutine(page.request, routineTitle, stepText);
    await previewButton.click();
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByText(routineTitle)).toBeVisible();
    await frame
      .getByTestId("display-by-person")
      .locator(".display-person-card")
      .filter({ hasText: /Avery/i })
      .click();
    await expect(frame.getByTestId("display-detail")).toBeVisible();
    await frame
      .getByTestId("display-detail")
      .locator("button.display-work-row")
      .filter({ hasText: routineTitle })
      .click();
    await expect(frame.getByText(stepText)).toBeVisible();

    const averyCtx = await browser.newContext();
    const avery = await averyCtx.newPage();
    await ensureManagerSession(avery.request);
    const enroll = await avery.request.post("/api/v1/enrollment/claims", {
      headers: await csrfHeaders(avery.request),
      data: { mutationId: crypto.randomUUID(), membershipId: AVERY_ID, preset: "direct_personalizer" },
    });
    if (enroll.ok()) {
      const token = ((await enroll.json()) as { claim: { token: string } }).claim.token;
      await avery.request.post("/api/v1/auth/logout", { headers: await csrfHeaders(avery.request) });
      const claim = await avery.request.post("/api/v1/auth/claim", {
        headers: { Origin: requestOrigin() },
        data: {
          claimToken: token,
          loginName: AVERY_LOGIN,
          passphrase: PASSPHRASE,
          displayName: "Avery Reed",
        },
      });
      expect(claim.ok(), await claim.text()).toBeTruthy();
    } else {
      await avery.request.post("/api/v1/auth/logout", { headers: await csrfHeaders(avery.request) }).catch(() => undefined);
      const login = await avery.request.post("/api/v1/auth/login", {
        headers: { Origin: requestOrigin() },
        data: { loginName: AVERY_LOGIN, passphrase: PASSPHRASE },
      });
      expect(login.ok(), await login.text()).toBeTruthy();
    }
    const today = await avery.request.get("/api/v1/today");
    const todayBody = (await today.json()) as {
      activityGeneration: number;
      occurrences: Array<{
        id: string;
        title: string;
        kind: string;
        revisionId: string;
        accountableMemberId: string | null;
        steps: Array<{ id: string; text: string; status: string; logicalItemId?: string }>;
      }>;
    };
    const occurrence = todayBody.occurrences.find((item) =>
      item.steps.some((step) => step.text === stepText),
    );
    expect(occurrence).toBeTruthy();
    const step = occurrence!.steps.find((item) => item.text === stepText)!;
    const complete = await avery.request.post(
      `/api/v1/occurrences/${occurrence!.id}/steps/${step.id}/status`,
      {
        headers: await csrfHeaders(avery.request),
        data: {
          mutationId: crypto.randomUUID(),
          status: "completed",
          performedAt: new Date().toISOString(),
          activityGeneration: todayBody.activityGeneration,
          kind: occurrence!.kind,
        },
      },
    );
    expect(complete.ok(), await complete.text()).toBeTruthy();
    await expect(frame.getByTestId("display-detail")).toBeVisible();
    await expect(frame.getByText(/Done|completed/i).first()).toBeVisible({ timeout: 20_000 });

    for (let i = 0; i < 3; i += 1) {
      if (await frame.getByTestId("display-overview").isVisible()) break;
      await frame.getByRole("button", { name: "Back", exact: true }).click({ force: true });
    }
    await expect(frame.getByTestId("display-overview")).toBeVisible();
    const goneTitle = `Gone routine ${Date.now().toString(36)}`;
    const gone = await createAveryRoutine(page.request, goneTitle, "Vanish this step");
    await expect(frame.getByText(goneTitle)).toBeVisible({ timeout: 20_000 });
    await frame
      .getByTestId("display-by-person")
      .locator(".display-person-card")
      .filter({ hasText: /Avery/i })
      .click();
    await expect(frame.getByTestId("display-detail")).toBeVisible();
    await frame
      .getByTestId("display-detail")
      .locator("button.display-work-row")
      .filter({ hasText: goneTitle })
      .click();
    await expect(frame.getByText("Vanish this step")).toBeVisible();
    const ended = await page.request.post(`/api/v1/routines/${gone.routine.id}/end`, {
      headers: await csrfHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        expectedVersion: gone.routine.version,
      },
    });
    expect(ended.ok(), await ended.text()).toBeTruthy();
    await expect(frame.getByTestId("display-detail-unavailable")).toBeVisible({ timeout: 20_000 });
    await averyCtx.close();
  });

  test("AT5b/AT5c/AT5d/AT5f: withdrawal, authority loss, fences, and stale recovery", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__HD_PREVIEW_POLL_MS = 700;
      window.__HD_PREVIEW_STALE_MS = 60_000;
    });
    const label = `Fence ${Date.now().toString(36)}`;
    await createPreviewDisplay(page, label);
    const taskTitle = `Library wall ${Date.now().toString(36)}`;
    const createdTask = await page.request.post("/api/v1/personal-tasks", {
      headers: await csrfHeaders(page.request),
      data: { title: taskTitle, visibility: "household", showOnSharedDashboard: true },
    });
    expect(createdTask.ok(), await createdTask.text()).toBeTruthy();
    const task = (await createdTask.json()) as {
      task: { id: string; sharingVersion: number };
    };

    await page
      .locator("li.display-manager-row")
      .filter({ hasText: label })
      .getByRole("button", { name: "Preview display" })
      .click();
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await frame.getByTestId("display-org-by-work").click();
    await expect(frame.getByTestId("display-by-work")).toBeVisible();
    await expect(frame.getByTestId("display-promoted-personal")).toContainText(taskTitle, {
      timeout: 20_000,
    });

    let releaseHold = () => undefined as void;
    let holdNext = false;
    let heldBody: string | null = null;
    await page.route("**/api/v1/displays/**/preview/dashboard", async (route) => {
      if (holdNext) {
        holdNext = false;
        const response = await route.fetch();
        heldBody = await response.text();
        await new Promise<void>((resolve) => {
          releaseHold = resolve;
        });
        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body: heldBody,
        });
        return;
      }
      await route.continue();
    });
    holdNext = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const privatize = await page.request.post(`/api/v1/personal-tasks/${task.task.id}/sharing`, {
      headers: await csrfHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        visibility: "private",
        showOnSharedDashboard: false,
        expectedSharingVersion: task.task.sharingVersion,
      },
    });
    expect(privatize.ok(), await privatize.text()).toBeTruthy();
    await expect(frame.getByText(taskTitle)).toHaveCount(0, { timeout: 20_000 });
    releaseHold();
    await page.waitForTimeout(300);
    await expect(frame.getByText(taskTitle)).toHaveCount(0);
    expect(heldBody).toBeTruthy();
    expect(heldBody!).toContain(taskTitle);

    await page.unroute("**/api/v1/displays/**/preview/dashboard");
    let poison: "date" | "gen" | "done" = "date";
    await page.route("**/api/v1/displays/**/preview/dashboard", async (route) => {
      try {
        const response = await route.fetch();
        const body = await response.text();
        let parsed: {
          householdDate?: string;
          activityGeneration?: number;
          serverTime?: string;
          dashboard?: { householdDate?: string };
        };
        try {
          parsed = JSON.parse(body) as typeof parsed;
        } catch {
          await route.fulfill({ status: response.status(), headers: response.headers(), body });
          return;
        }
        if (parsed.dashboard && poison === "date") {
          poison = "gen";
          parsed.householdDate = "2020-01-01";
          parsed.dashboard.householdDate = "2020-01-01";
          parsed.serverTime = "2020-01-01T15:00:00.000Z";
          await route.fulfill({
            status: 200,
            headers: { ...response.headers(), "content-type": "application/json" },
            body: JSON.stringify(parsed),
          });
          return;
        }
        if (parsed.dashboard && poison === "gen") {
          poison = "done";
          parsed.activityGeneration = 0;
          await route.fulfill({
            status: 200,
            headers: { ...response.headers(), "content-type": "application/json" },
            body: JSON.stringify(parsed),
          });
          return;
        }
        await route.fulfill({ status: response.status(), headers: response.headers(), body });
      } catch {
        /* Route already handled by a concurrent intercept. */
      }
    });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(frame.locator(".display-date")).not.toContainText("January 1");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(frame.getByText(taskTitle)).toHaveCount(0);

    await page.unroute("**/api/v1/displays/**/preview/dashboard");
    await page.route("**/api/v1/displays/**/preview/dashboard", (route) => route.abort());
    await page.evaluate(() => {
      window.__HD_PREVIEW_NOW_MS = Date.now() + 61_000;
      window.__HD_PREVIEW_FORCE_STALE__?.();
    });
    await expect(frame.getByTestId("display-preview-frame-empty")).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByText(/expired|Loading preview|No preview data/i)).toBeVisible();

    await page.unroute("**/api/v1/displays/**/preview/dashboard");
    await page.evaluate(() => {
      delete window.__HD_PREVIEW_NOW_MS;
    });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(frame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByText(taskTitle)).toHaveCount(0);

    const displayId = new URL(page.url()).pathname.split("/")[3]!;
    await page.request.post(`/api/v1/displays/${displayId}/revoke`, {
      headers: await csrfHeaders(page.request),
      data: { mutationId: crypto.randomUUID(), expectedConfigVersion: 1 },
    });
    await expect(page.getByTestId("display-preview-error")).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByTestId("display-overview")).toHaveCount(0);
  });

  test("AT5d/AT5f: held replies cannot replace a newer context or renew stale", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__HD_PREVIEW_POLL_MS = 30_000;
      window.__HD_PREVIEW_STALE_MS = 60_000;
    });
    const label = `Held ${Date.now().toString(36)}`;
    await createPreviewDisplay(page, label);
    await page
      .locator("li.display-manager-row")
      .filter({ hasText: label })
      .getByRole("button", { name: "Preview display" })
      .click();
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    const displayId = new URL(page.url()).pathname.split("/")[3]!;

    const averyCard = frame
      .getByTestId("display-by-person")
      .locator(".display-person-card")
      .filter({ hasText: /Avery/i });
    await averyCard.click();
    await expect(frame.getByTestId("display-detail")).toBeVisible();
    const personSnap = await page.request.get(
      `/api/v1/displays/${displayId}/preview/people/${AVERY_ID}`,
    );
    expect(personSnap.ok()).toBeTruthy();
    const heldPerson = await armHeldPreview(
      page,
      "**/api/v1/displays/**/preview/people/**",
      await personSnap.text(),
    );
    await postPreviewBack(page);
    await expect(frame.getByTestId("display-overview")).toBeVisible();
    await averyCard.click();
    await heldPerson.captured;
    await postPreviewBack(page);
    await expect(frame.getByTestId("display-overview")).toBeVisible();
    await heldPerson.release();
    await page.waitForTimeout(300);
    await expect(frame.getByTestId("display-overview")).toBeVisible();
    await expect(frame.getByTestId("display-detail")).toHaveCount(0);
    await page.unroute("**/api/v1/displays/**/preview/people/**");

    const occTitle = `Held occ ${Date.now().toString(36)}`;
    await createAveryRoutine(page.request, occTitle, "Held occurrence step");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(frame.getByText(occTitle)).toBeAttached({ timeout: 20_000 });
    await averyCard.click();
    await expect(frame.getByTestId("display-detail")).toBeVisible();
    const personForOcc = await page.request.get(
      `/api/v1/displays/${displayId}/preview/people/${AVERY_ID}`,
    );
    expect(personForOcc.ok()).toBeTruthy();
    const personOccBody = (await personForOcc.json()) as {
      person: { recurringWork: Array<{ occurrenceId: string; title: string }> };
    };
    const occId = personOccBody.person.recurringWork.find((row) => row.title === occTitle)
      ?.occurrenceId;
    expect(occId).toBeTruthy();
    await frame
      .getByTestId("display-detail")
      .locator("button.display-work-row")
      .filter({ hasText: occTitle })
      .click();
    await expect(frame.locator(".display-step").first()).toBeVisible();
    const occSnap = await page.request.get(
      `/api/v1/displays/${displayId}/preview/occurrences/${occId}`,
    );
    expect(occSnap.ok(), await occSnap.text()).toBeTruthy();
    const heldOccurrence = await armHeldPreview(
      page,
      "**/api/v1/displays/**/preview/occurrences/**",
      await occSnap.text(),
    );
    await postPreviewBack(page);
    await expect(frame.getByTestId("display-overview")).toBeVisible();
    await averyCard.click();
    await expect(frame.getByTestId("display-detail")).toBeVisible();
    await frame
      .getByTestId("display-detail")
      .locator("button.display-work-row")
      .filter({ hasText: occTitle })
      .click();
    await heldOccurrence.captured;
    await postPreviewBack(page);
    await expect(frame.getByTestId("display-overview")).toBeVisible();
    await heldOccurrence.release();
    await page.waitForTimeout(300);
    await expect(frame.getByTestId("display-overview")).toBeVisible();
    await expect(frame.getByTestId("display-detail")).toHaveCount(0);
    await page.unroute("**/api/v1/displays/**/preview/occurrences/**");

    const dashSnap = await page.request.get(`/api/v1/displays/${displayId}/preview/dashboard`);
    expect(dashSnap.ok()).toBeTruthy();
    const dashBody = await dashSnap.text();
    const heldOver = await armHeldPreview(page, "**/api/v1/displays/**/preview/dashboard", dashBody);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await heldOver.captured;
    const genTitle = `Gen fence ${Date.now().toString(36)}`;
    await createAveryRoutine(page.request, genTitle, "Generation step");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(frame.getByText(genTitle)).toBeAttached({ timeout: 20_000 });
    await heldOver.release((body) => {
      const parsed = JSON.parse(body) as {
        householdDate?: string;
        activityGeneration?: number;
        serverTime?: string;
        dashboard?: { householdDate?: string };
      };
      parsed.householdDate = "2020-01-01";
      parsed.serverTime = "2020-01-01T15:00:00.000Z";
      parsed.activityGeneration = 0;
      if (parsed.dashboard) parsed.dashboard.householdDate = "2020-01-01";
      return JSON.stringify(parsed);
    });
    await page.waitForTimeout(300);
    await expect(frame.locator(".display-date")).not.toContainText("January 1");
    await expect(frame.getByText(genTitle)).toBeAttached();
    await expect(frame.getByTestId("display-overview")).toBeVisible();
    await page.unroute("**/api/v1/displays/**/preview/dashboard");

    const heldLate = await armHeldPreview(page, "**/api/v1/displays/**/preview/dashboard", dashBody);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await heldLate.captured;
    await page.evaluate(() => {
      window.__HD_PREVIEW_NOW_MS = Date.now() + 61_000;
      window.__HD_PREVIEW_FORCE_STALE__?.();
    });
    await expect(frame.getByTestId("display-preview-frame-empty")).toBeVisible({ timeout: 20_000 });
    await heldLate.release();
    await page.waitForTimeout(300);
    await expect(frame.getByTestId("display-preview-frame-empty")).toBeVisible();
    await expect(frame.getByTestId("display-overview")).toHaveCount(0);
    await expect(frame.getByText(genTitle)).toHaveCount(0);
    await page.unroute("**/api/v1/displays/**/preview/dashboard");
    await page.evaluate(() => {
      delete window.__HD_PREVIEW_NOW_MS;
    });

    await page.route("**/api/v1/displays/**/preview/dashboard", (route) => route.abort());
    await page.route("**/api/v1/displays/**/preview/people/**", (route) => route.abort());
    await page.route("**/api/v1/displays/**/preview/occurrences/**", (route) => route.abort());
    await page.reload();
    await expect(page.getByTestId("display-preview-host")).toBeVisible();
    const coldFrame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(coldFrame.getByTestId("display-preview-frame-empty")).toBeVisible({
      timeout: 20_000,
    });
    await expect(coldFrame.getByTestId("display-overview")).toHaveCount(0);
    await expect(coldFrame.getByText(/Avery/i)).toHaveCount(0);
    await page.unroute("**/api/v1/displays/**/preview/dashboard");
    await page.unroute("**/api/v1/displays/**/preview/people/**");
    await page.unroute("**/api/v1/displays/**/preview/occurrences/**");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(coldFrame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
  });

  test("AT5c session expiry clears preview without a display credential", async ({ page }) => {
    await page.addInitScript(() => {
      window.__HD_PREVIEW_POLL_MS = 600;
    });
    const previewButton = await createPreviewDisplay(page, `Expire ${Date.now().toString(36)}`);
    await previewButton.click();
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await page.request.post("/api/v1/auth/logout", { headers: await csrfHeaders(page.request) });
    await expect(page.getByRole("button", { name: "Sign in" }).or(page.getByTestId("display-preview-error"))).toBeVisible({
      timeout: 20_000,
    });
    await expect(frame.getByTestId("display-overview")).toHaveCount(0);
  });
});
