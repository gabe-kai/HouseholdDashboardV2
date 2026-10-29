import { expect, test, type Page, type Route } from "@playwright/test";
import {
  AVERY_ID,
  JORDAN_ID,
  csrfHeaders,
  enrollWall,
  ensureManagerSession,
  createAssignedRoutine,
  startOccurrenceByStepText,
  fetchPersonDay,
  completeDisplayStep,
  completeOtherOccurrences,
  clickFamilyControl,
} from "../helpers/p0-009b";

async function armHeld(
  page: Page,
  match: string | ((url: URL) => boolean),
  snapshot: string,
) {
  let capturedResolve: () => void = () => undefined;
  const captured = new Promise<void>((resolve) => {
    capturedResolve = resolve;
  });
  let releaseResolve: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    releaseResolve = resolve;
  });
  let armed = true;
  await page.route(match, async (route: Route) => {
    if (!armed) {
      await route.continue();
      return;
    }
    armed = false;
    capturedResolve();
    await released;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: snapshot,
    });
  });
  return {
    captured,
    release: async () => {
      releaseResolve();
    },
  };
}

async function revealStep(page: Page, membershipId: string, name: string) {
  const button = page.getByRole("button", { name });
  if (await button.isVisible().catch(() => false)) return button;
  await clickFamilyControl(page, `family-upcoming-${membershipId}`);
  if (await button.isVisible().catch(() => false)) return button;
  await clickFamilyControl(page, `family-more-${membershipId}`);
  if (await button.isVisible().catch(() => false)) return button;
  await clickFamilyControl(page, `family-back-next-${membershipId}`);
  return button;
}

test.describe("P0-009B family wall recovery", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test("AT6a: pending Done stays on the acting pane until the held write settles", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("webkit"), "Chromium establishes held-write races");
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    const onlyStep = `Only step ${stamp}`;
    await createAssignedRoutine(request, {
      title: `Pending ${stamp}`,
      memberId: JORDAN_ID,
      steps: [{ text: `${stamp} pending marker` }, { text: onlyStep }],
    });
    await enrollWall(request, page, `Pending ${stamp}`);
    await startOccurrenceByStepText(page, JORDAN_ID, `${stamp} pending marker`);
    await completeOtherOccurrences(page, JORDAN_ID, `Pending ${stamp}`);
    await page.reload();
    await expect(page.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    await page.route("**/api/v1/display/occurrences/**/status", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    const done = await revealStep(page, JORDAN_ID, `Mark ${onlyStep} done`);
    await expect(done).toBeVisible();
    await done.click({ force: true });
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toBeVisible();
    await expect(done).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toHaveCount(0, { timeout: 20_000 });
  });

  test("AT6b/AT7b: rejected pane cue stays local; older Done cannot restore over reopen", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("webkit"), "Chromium establishes held-write races");
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    const toggleText = `Toggle me ${stamp}`;
    const failText = `Fail me ${stamp}`;
    await createAssignedRoutine(request, {
      title: `Race step ${stamp}`,
      memberId: AVERY_ID,
      steps: [{ text: `${stamp} toggle marker` }, { text: toggleText }],
    });
    await createAssignedRoutine(request, {
      title: `Reject step ${stamp}`,
      memberId: JORDAN_ID,
      steps: [{ text: `${stamp} reject marker` }, { text: failText }],
    });
    await enrollWall(request, page, `Reject ${stamp}`);
    await startOccurrenceByStepText(page, AVERY_ID, `${stamp} toggle marker`);
    await completeOtherOccurrences(page, AVERY_ID, `Race step ${stamp}`);
    await startOccurrenceByStepText(page, JORDAN_ID, `${stamp} reject marker`);
    await completeOtherOccurrences(page, JORDAN_ID, `Reject step ${stamp}`);
    await page.reload();
    await expect(page.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });

    const jordanDay = await fetchPersonDay(page, JORDAN_ID);
    const rejectOcc = jordanDay.occurrences.find((row) =>
      row.steps.some((step) => step.text === failText),
    );
    expect(rejectOcc).toBeTruthy();
    let jordanFails = true;
    await page.route("**/api/v1/display/occurrences/**/status", async (route) => {
      if (jordanFails && route.request().url().includes(rejectOcc!.id)) {
        jordanFails = false;
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            code: "CONFLICT",
            message: "Structure changed",
            error: { code: "CONFLICT", message: "Structure changed" },
          }),
        });
        return;
      }
      await route.continue();
    });
    const jordanDone = await revealStep(page, JORDAN_ID, `Mark ${failText} done`);
    await expect(jordanDone).toBeVisible();
    await jordanDone.click({ force: true });
    await expect(page.getByTestId(`family-error-${JORDAN_ID}`)).toBeVisible({ timeout: 20_000 });
    await clickFamilyControl(page, `family-upcoming-${AVERY_ID}`);
    await expect(page.getByTestId(`family-error-${JORDAN_ID}`)).toBeVisible();
    await page.getByTestId("display-org-by-work").click({ force: true });
    await page.getByTestId("display-org-by-person").click({ force: true });
    await expect(page.getByTestId(`family-error-${JORDAN_ID}`)).toBeVisible();

    const averyDone = await revealStep(page, AVERY_ID, `Mark ${toggleText} done`);
    await page.unroute("**/api/v1/display/occurrences/**/status");
    let holdDone = true;
    let releaseDone = () => undefined as void;
    const heldDone = new Promise<void>((resolve) => {
      releaseDone = resolve;
    });
    await page.route("**/api/v1/display/occurrences/**/status", async (route) => {
      if (holdDone) {
        holdDone = false;
        await heldDone;
      }
      await route.continue();
    });
    await averyDone.click({ force: true });
    await averyDone.click({ force: true });
    releaseDone();
    await expect(averyDone).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
  });

  test("AT8a/AT9a/AT9b: cold offline has no household payload; live and reconnect preserve sibling position", async ({
    page,
    request,
  }) => {
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    const title = `Live ${stamp}`;
    await createAssignedRoutine(request, {
      title,
      memberId: AVERY_ID,
      steps: [{ text: `${stamp} live marker` }, { text: "Live step" }],
    });
    await createAssignedRoutine(request, {
      title: `Jordan live ${stamp}`,
      memberId: JORDAN_ID,
      steps: [{ text: `${stamp} jordan marker` }, { text: "Jordan live" }],
    });
    await enrollWall(request, page, `Live wall ${stamp}`);
    await startOccurrenceByStepText(page, AVERY_ID, `${stamp} live marker`);
    await completeOtherOccurrences(page, AVERY_ID, title);
    await startOccurrenceByStepText(page, JORDAN_ID, `${stamp} jordan marker`);
    await completeOtherOccurrences(page, JORDAN_ID, `Jordan live ${stamp}`);
    await page.reload();
    await expect(page.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    await clickFamilyControl(page, `family-upcoming-${JORDAN_ID}`);
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-section", "upcoming");
    const personDay = await fetchPersonDay(page, AVERY_ID);
    const averyOcc = personDay.occurrences.find((row) => row.title === title);
    expect(averyOcc?.intendedStructure).toBeTruthy();
    const liveStep = averyOcc!.steps.find((row) => row.text === "Live step");
    expect(liveStep).toBeTruthy();
    await completeDisplayStep(page, averyOcc!, liveStep!.id);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toContainText(/Done|completed/i, {
      timeout: 20_000,
    });
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute(
      "data-section",
      "upcoming",
    );

    await page.evaluate(() => {
      window.__HD_DISPLAY_CLOSE_SYNC__?.();
    });
    const missedTitle = `Missed ${stamp}`;
    await createAssignedRoutine(request, {
      title: missedTitle,
      memberId: AVERY_ID,
      steps: [{ text: "Missed step" }],
    });
    await expect
      .poll(async () => {
        const day = await page.request.get(`/api/v1/display/people/${AVERY_ID}/day`);
        return (await day.text()).includes(missedTitle);
      })
      .toBeTruthy();
    await page.evaluate(() => {
      window.__HD_DISPLAY_RECONNECT_SYNC__?.();
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });
    await expect
      .poll(
        async () => {
          await page.evaluate(() => {
            window.__HD_DISPLAY_RECONNECT_SYNC__?.();
            document.dispatchEvent(new Event("visibilitychange"));
          });
          await clickFamilyControl(page, `family-back-next-${AVERY_ID}`);
          if (await page.getByText(missedTitle).isVisible().catch(() => false)) return true;
          await clickFamilyControl(page, `family-upcoming-${AVERY_ID}`);
          if (await page.getByText(missedTitle).isVisible().catch(() => false)) return true;
          await clickFamilyControl(page, `family-more-${AVERY_ID}`);
          return page.getByText(missedTitle).isVisible().catch(() => false);
        },
        { timeout: 20_000 },
      )
      .toBeTruthy();
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute(
      "data-section",
      "upcoming",
    );

    await page.route("**/api/v1/display/**", async (route) => {
      await route.abort();
    });
    await page.reload();
    await expect(page.getByTestId("family-board")).toHaveCount(0);
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test("AT10a/AT10b/AT11b/AT11c: stale pane lease, old snapshot, and lost enlargement cannot paint", async ({
    page,
    request,
  }) => {
    await page.addInitScript(() => {
      window.__HD_DISPLAY_PANE_STALE_MS = 1500;
    });
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    await createAssignedRoutine(request, {
      title: `Stale ${stamp}`,
      memberId: AVERY_ID,
      steps: [{ text: "Original step" }],
    });
    await createAssignedRoutine(request, {
      title: `Sibling ${stamp}`,
      memberId: JORDAN_ID,
      steps: [{ text: "Sibling step" }],
    });
    await enrollWall(request, page, `Stale ${stamp}`);
    const oldBody = await (await page.request.get(`/api/v1/display/people/${AVERY_ID}/day`)).text();

    let failAvery = true;
    await page.route(`**/api/v1/display/people/${AVERY_ID}/day`, async (route) => {
      if (failAvery) {
        await route.fulfill({ status: 500, body: JSON.stringify({ code: "INTERNAL" }) });
        return;
      }
      await route.continue();
    });
    await page.reload();
    await expect(page.getByTestId(`family-unavailable-${AVERY_ID}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-phase", "ready");
    await page.evaluate(() => {
      window.__HD_DISPLAY_NOW_MS = performance.now() + 4_000;
    });
    await page.waitForTimeout(700);
    await expect(page.getByTestId(`family-blank-${AVERY_ID}`)).toBeVisible();
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-phase", "ready");

    await page.evaluate(() => {
      delete window.__HD_DISPLAY_NOW_MS;
    });
    failAvery = false;
    await page.unroute(`**/api/v1/display/people/${AVERY_ID}/day`);
    await clickFamilyControl(page, `family-retry-${AVERY_ID}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready", {
      timeout: 15_000,
    });

    const personDay = await fetchPersonDay(page, AVERY_ID);
    const original = personDay.occurrences.find((row) =>
      row.steps.some((step) => step.text === "Original step"),
    );
    expect(original?.intendedStructure).toBeTruthy();
    const originalStep = original!.steps.find((step) => step.text === "Original step");
    await completeDisplayStep(page, original!, originalStep!.id);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toContainText(/Done|completed/i, {
      timeout: 20_000,
    });
    const heldOld = await armHeld(page, `**/api/v1/display/people/${AVERY_ID}/day`, oldBody);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await heldOld.captured;
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toContainText(/Done|completed/i);
    await heldOld.release();
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toContainText(/Done|completed/i);

    await page.unroute(`**/api/v1/display/people/${AVERY_ID}/day`);
    const currentBody = await (await page.request.get(`/api/v1/display/people/${AVERY_ID}/day`)).text();
    const heldLate = await armHeld(page, `**/api/v1/display/people/${AVERY_ID}/day`, currentBody);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await heldLate.captured;
    await page.evaluate(() => {
      window.__HD_DISPLAY_NOW_MS = performance.now() + 4_000;
    });
    await heldLate.release();
    await expect(page.getByTestId(`family-blank-${AVERY_ID}`)).toBeVisible();

    await page.evaluate(() => {
      delete window.__HD_DISPLAY_NOW_MS;
    });
    await page.unroute(`**/api/v1/display/people/${AVERY_ID}/day`);
    await clickFamilyControl(page, `family-retry-${AVERY_ID}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready", {
      timeout: 15_000,
    });

    const detailBody = await (await page.request.get(`/api/v1/display/people/${AVERY_ID}`)).text();
    const enlargeHeld = await armHeld(
      page,
      (url) =>
        url.pathname.endsWith(`/api/v1/display/people/${AVERY_ID}`) &&
        !url.pathname.endsWith("/day"),
      detailBody,
    );
    await clickFamilyControl(page, `family-personal-${AVERY_ID}`);
    await enlargeHeld.captured;
    await page.getByRole("button", { name: "Back" }).click({ force: true });
    await clickFamilyControl(page, `family-personal-${JORDAN_ID}`);
    await expect(page.getByTestId("display-detail")).toBeVisible();
    await enlargeHeld.release();
    await expect(page.getByTestId("display-detail")).toBeVisible();
    await expect(page.getByTestId("display-detail")).toContainText("Jordan Reed");
  });

  test("AT13c/AT14d: withdrawn personal work disappears; revoke clears the board", async ({
    page,
    request,
  }) => {
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    const title = `PROMOTED-E2E-${stamp}`;
    const taskRes = await request.post("/api/v1/personal-tasks", {
      headers: await csrfHeaders(request),
      data: {
        title,
        visibility: "household",
        showOnSharedDashboard: true,
      },
    });
    expect(taskRes.ok(), await taskRes.text()).toBeTruthy();
    const task = (await taskRes.json()) as { task: { id: string; sharingVersion: number } };
    const displayId = await enrollWall(request, page, `Withdraw ${stamp}`);
    await expect(page.getByText(title)).toBeVisible();
    const sharing = await request.post(`/api/v1/personal-tasks/${task.task.id}/sharing`, {
      headers: await csrfHeaders(request),
      data: {
        mutationId: crypto.randomUUID(),
        visibility: "private",
        showOnSharedDashboard: false,
        expectedSharingVersion: task.task.sharingVersion,
      },
    });
    expect(sharing.ok(), await sharing.text()).toBeTruthy();
    await expect(page.getByText(title)).toHaveCount(0, { timeout: 20_000 });

    const displays = await request.get("/api/v1/displays");
    const row = (
      (await displays.json()) as {
        displays: Array<{ id: string; configVersion: number }>;
      }
    ).displays.find((display) => display.id === displayId);
    expect(row).toBeTruthy();
    const revoked = await request.post(`/api/v1/displays/${row!.id}/revoke`, {
      headers: await csrfHeaders(request),
      data: { mutationId: crypto.randomUUID(), expectedConfigVersion: row!.configVersion },
    });
    expect(revoked.ok(), await revoked.text()).toBeTruthy();
    await expect(page.getByTestId("family-board")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("display-setup")).toBeVisible();
  });

  test("AT14a: prior-day held person-day and pending Done cannot return after date change", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("webkit"), "Chromium establishes held-read date races");
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    const marker = `Yesterday ${stamp}`;
    const nextDayMarker = `NEXT_DAY_${stamp}`;
    await createAssignedRoutine(request, {
      title: `Rollover ${stamp}`,
      memberId: AVERY_ID,
      steps: [{ text: `${stamp} start` }, { text: marker }],
    });
    await enrollWall(request, page, `Rollover ${stamp}`);
    await startOccurrenceByStepText(page, AVERY_ID, `${stamp} start`);
    await completeOtherOccurrences(page, AVERY_ID, `Rollover ${stamp}`);
    await page.reload();
    await expect(page.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    const oldBody = await (await page.request.get(`/api/v1/display/people/${AVERY_ID}/day`)).text();
    await page.route("**/api/v1/display/occurrences/**/status", (route) => route.abort());
    const done = await revealStep(page, AVERY_ID, `Mark ${marker} done`);
    await expect(done).toBeVisible();
    await done.click({ force: true });
    await expect(page.getByTestId(`family-pending-${AVERY_ID}`)).toBeVisible();

    const nextHouseholdDate = "2099-12-31";
    await page.route("**/api/v1/display/dashboard", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          dashboard: {
            householdDate: nextHouseholdDate,
            timezone: "America/New_York",
            serverTime: "2099-12-31T15:00:00.000Z",
            activityGeneration: 1,
            byPerson: [
              {
                membershipId: AVERY_ID,
                displayName: "Avery Reed",
                sortOrder: 0,
                status: "active",
                recurringState: "Not started",
                progress: { done: 0, notNeeded: 0, open: 1, optionalOpen: 0, total: 1 },
                progressLabel: "0/1 done",
                unfinished: [{ occurrenceId: crypto.randomUUID(), title: nextDayMarker, kind: "routine" }],
                promotedPersonalTasks: [],
              },
            ],
            byWork: { responsibilities: [], routines: [] },
            promotedPersonalTasks: [],
          },
        }),
      });
    });
    const heldOld = await armHeld(page, `**/api/v1/display/people/${AVERY_ID}/day`, oldBody);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByTestId("display-retired-notices")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(marker)).toHaveCount(0);
    await heldOld.captured;
    await heldOld.release();
    await expect(page.getByText(marker)).toHaveCount(0);
    await expect(page.getByTestId("display-pending-cue")).toHaveCount(0);
  });

  test("AT14b: activity clear retires old generation pane bodies", async ({ page, request }) => {
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    const title = `Cleared ${stamp}`;
    await createAssignedRoutine(request, {
      title,
      memberId: AVERY_ID,
      steps: [{ text: `${stamp} keep` }, { text: `${stamp} done later` }],
    });
    await enrollWall(request, page, `Clear ${stamp}`);
    await startOccurrenceByStepText(page, AVERY_ID, `${stamp} keep`);
    await completeOtherOccurrences(page, AVERY_ID, title);
    await page.reload();
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toContainText(title, { timeout: 20_000 });
    const oldJson = (await (
      await page.request.get(`/api/v1/display/people/${AVERY_ID}/day`)
    ).json()) as {
      personDay: { activityGeneration: number; occurrences: Array<{ title: string }> };
    };
    const resurrect = `RESURRECT-OLD-GEN-${stamp}`;
    const poisoned = JSON.stringify({
      ...oldJson,
      personDay: {
        ...oldJson.personDay,
        occurrences: oldJson.personDay.occurrences.map((row) =>
          row.title === title ? { ...row, title: resurrect } : row,
        ),
      },
    });
    const today = await request.get("/api/v1/today");
    expect(today.ok(), await today.text()).toBeTruthy();
    const { activityGeneration } = (await today.json()) as { activityGeneration: number };
    const heldOld = await armHeld(page, `**/api/v1/display/people/${AVERY_ID}/day`, poisoned);
    const cleared = await request.post("/api/v1/household/activity/clear", {
      headers: await csrfHeaders(request),
      data: {
        mutationId: crypto.randomUUID(),
        expectedGeneration: activityGeneration,
        acknowledgedScope: "routines_and_responsibilities",
      },
    });
    expect(cleared.ok(), await cleared.text()).toBeTruthy();
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await heldOld.captured;
    await expect(page.getByTestId("family-board")).toBeVisible();
    await expect(page.getByTestId("display-setup")).toHaveCount(0);
    await heldOld.release();
    await expect(page.getByText(resurrect)).toHaveCount(0);
    await page.unroute(`**/api/v1/display/people/${AVERY_ID}/day`);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByTestId("family-board")).toBeVisible();
    await expect(page.getByText(resurrect)).toHaveCount(0);
    const after = await page.request.get(`/api/v1/display/people/${AVERY_ID}/day`);
    expect(after.ok()).toBeTruthy();
    const afterBody = (await after.json()) as { personDay: { activityGeneration: number } };
    expect(afterBody.personDay.activityGeneration).toBeGreaterThan(oldJson.personDay.activityGeneration);
  });
});
