import { expect, test, type Page, type Route, type WebSocket } from "@playwright/test";
import { wipeSeededE2eServer } from "../helpers/e2e-restart-server";
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
  householdDate,
  requestOrigin,
} from "../helpers/p0-009b";

async function displayOutboxItems(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async () => new Promise((resolve, reject) => {
    const open = indexedDB.open("keyval-store");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const store = db.transaction("keyval", "readonly").objectStore("keyval");
      const keys = store.getAllKeys();
      const values = store.getAll();
      keys.onerror = () => reject(keys.error);
      values.onerror = () => reject(values.error);
      values.onsuccess = () => {
        const items = keys.result.flatMap((key, index) =>
          typeof key === "string" && key.startsWith("hd-display-outbox-v1:") && Array.isArray(values.result[index])
            ? values.result[index] as Array<Record<string, unknown>> : [],
        );
        db.close();
        resolve(items);
      };
    };
  }));
}

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
  let deliveredResolve: () => void = () => undefined;
  const delivered = new Promise<void>((resolve) => { deliveredResolve = resolve; });
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
    deliveredResolve();
  });
  return {
    captured,
    delivered,
    release: async () => {
      releaseResolve();
    },
  };
}

async function revealStep(page: Page, membershipId: string, name: string) {
  const button = page.getByTestId(`family-pane-${membershipId}`).getByRole("button", { name }).first();
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

  test("AT14e: departure removes a pending owner's pane without transferring the action", async ({ page, request, browser }, testInfo) => {
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    const personResponse = await request.post("/api/v1/people", {
      headers: await csrfHeaders(request),
      data: { mutationId: crypto.randomUUID(), displayName: `Pat ${stamp}`, classification: "child" },
    });
    expect(personResponse.ok(), await personResponse.text()).toBeTruthy();
    const personId = ((await personResponse.json()) as { person: { id: string } }).person.id;
    const enrollment = await request.post("/api/v1/enrollment/claims", {
      headers: await csrfHeaders(request),
      data: { mutationId: crypto.randomUUID(), membershipId: personId, preset: "direct_personalizer" },
    });
    expect(enrollment.ok(), await enrollment.text()).toBeTruthy();
    const token = ((await enrollment.json()) as { claim: { token: string } }).claim.token;
    const childContext = await browser.newContext();
    const child = await childContext.newPage();
    const claim = await child.request.post("/api/v1/auth/claim", {
      headers: { Origin: requestOrigin() },
      data: { claimToken: token, loginName: `pat.${stamp}`, passphrase: "unique-passphrase-ok!", displayName: `Pat ${stamp}` },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    await childContext.close();
    const group = await request.post("/api/v1/groups", {
      headers: await csrfHeaders(request),
      data: { mutationId: crypto.randomUUID(), name: `Departure ${stamp}`, membershipIds: [personId, JORDAN_ID] },
    });
    expect(group.ok(), await group.text()).toBeTruthy();
    const groupId = ((await group.json()) as { group: { id: string } }).group.id;
    const title = `Departing work ${stamp}`;
    const step = `Departing step ${stamp}`;
    const responsibility = await request.post("/api/v1/responsibilities", {
      headers: await csrfHeaders(request),
      data: {
        mutationId: crypto.randomUUID(), title, daypart: "morning", weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: { mode: "take_turns", anchorDate: await householdDate(request), sourceGroupId: groupId, savedRingOrder: [personId, JORDAN_ID], excludedMemberIds: [] },
        steps: [{ logicalItemId: crypto.randomUUID(), text: step, obligation: "required" }],
      },
    });
    expect(responsibility.ok(), await responsibility.text()).toBeTruthy();
    await enrollWall(request, page, `Departure ${stamp}`);
    const patPane = page.getByTestId(`family-pane-${personId}`);
    await expect(patPane).toHaveAttribute("data-phase", "ready", { timeout: 20_000 });
    await page.route("**/api/v1/display/occurrences/**/status", (route) => route.abort());
    await patPane.getByRole("button", { name: `Mark ${step} done` }).click();
    await expect(page.getByTestId(`family-pending-${personId}`)).toBeVisible();
    const peopleResponse = await request.get("/api/v1/people");
    const person = ((await peopleResponse.json()) as { people: Array<{ id: string; authorityVersion: number; version: number }> }).people.find((row) => row.id === personId);
    expect(person).toBeTruthy();
    const preview = await request.post(`/api/v1/people/${personId}/removal/preview`, {
      headers: await csrfHeaders(request), data: { expectedAuthorityVersion: person!.authorityVersion, expectedVersion: person!.version },
    });
    expect(preview.ok(), await preview.text()).toBeTruthy();
    const digest = ((await preview.json()) as { previewDigest: string }).previewDigest;
    const removal = await request.post(`/api/v1/people/${personId}/removal`, {
      headers: await csrfHeaders(request),
      data: { mutationId: crypto.randomUUID(), expectedAuthorityVersion: person!.authorityVersion, expectedVersion: person!.version, passphrase: "unique-passphrase-ok!", previewDigest: digest, confirmationText: "REMOVE" },
    });
    expect(removal.ok(), await removal.text()).toBeTruthy();
    await expect(patPane).toHaveCount(0, { timeout: 20_000 });
    await page.unroute("**/api/v1/display/occurrences/**/status");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByTestId("display-retired-notices")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => {
      const day = await fetchPersonDay(page, JORDAN_ID);
      return day.occurrences.find((row) => row.title === title)?.steps.find((row) => row.text === step)?.status;
    }, { timeout: 20_000 }).toBe("open");
    expect(testInfo.project.use.baseURL).toBeTruthy();
    await page.close();
    await wipeSeededE2eServer(testInfo.project.use.baseURL!);
  });

  test("AT7a: lost first response retries the same command and flushes a sibling action", async ({ page, request }) => {
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    const aTitle = `Replay Avery ${stamp}`;
    const jTitle = `Replay Jordan ${stamp}`;
    await createAssignedRoutine(request, { title: aTitle, memberId: AVERY_ID, steps: [{ text: `Avery replay ${stamp}` }] });
    await createAssignedRoutine(request, { title: jTitle, memberId: JORDAN_ID, steps: [{ text: `Jordan replay ${stamp}` }] });
    await enrollWall(request, page, `Replay ${stamp}`);
    await completeOtherOccurrences(page, AVERY_ID, aTitle);
    await completeOtherOccurrences(page, JORDAN_ID, jTitle);
    await page.reload();
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-phase", "ready");
    const aDay = await fetchPersonDay(page, AVERY_ID);
    const a = aDay.occurrences.find((row) => row.title === aTitle);
    expect(a).toBeTruthy();
    const mutationIds: string[] = [];
    let first = true;
    let releaseRetry = () => undefined as void;
    const retryHold = new Promise<void>((resolve) => { releaseRetry = resolve; });
    let lostResolve = () => undefined as void;
    const lost = new Promise<void>((resolve) => { lostResolve = resolve; });
    await page.route("**/api/v1/display/occurrences/**/status", async (route) => {
      if (!route.request().url().includes(a!.id)) return route.continue();
      const body = route.request().postDataJSON() as { mutationId: string };
      mutationIds.push(body.mutationId);
      if (first) {
        first = false;
        const committed = await route.fetch();
        expect(committed.ok()).toBeTruthy();
        await route.abort();
        lostResolve();
        return;
      }
      await retryHold;
      await route.continue();
    });
    await page.getByRole("button", { name: `Mark Avery replay ${stamp} done` }).click();
    await lost;
    await expect(page.getByTestId(`family-pending-${AVERY_ID}`)).toBeVisible();
    await page.getByRole("button", { name: `Mark Jordan replay ${stamp} done` }).click();
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toBeVisible();
    releaseRetry();
    await expect(page.getByTestId(`family-pending-${AVERY_ID}`)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toHaveCount(0, { timeout: 20_000 });
    expect(mutationIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(mutationIds).size).toBe(1);
    await expect.poll(async () => (await fetchPersonDay(page, AVERY_ID)).occurrences.find((row) => row.title === aTitle)?.steps[0]?.status).toBe("completed");
    await expect.poll(async () => (await fetchPersonDay(page, JORDAN_ID)).occurrences.find((row) => row.title === jTitle)?.steps[0]?.status).toBe("completed");
  });

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
    await createAssignedRoutine(request, {
      title: `Next after pending ${stamp}`,
      memberId: JORDAN_ID,
      daypart: "after_school",
      steps: [{ text: `Following step ${stamp}` }],
    });
    await createAssignedRoutine(request, {
      title: `Last after pending ${stamp}`,
      memberId: JORDAN_ID,
      daypart: "anytime",
      steps: [{ text: `Last step ${stamp}` }],
    });
    await enrollWall(request, page, `Pending ${stamp}`);
    await startOccurrenceByStepText(page, JORDAN_ID, `${stamp} pending marker`);
    await completeOtherOccurrences(page, JORDAN_ID, [`Pending ${stamp}`, `Next after pending ${stamp}`, `Last after pending ${stamp}`]);
    await page.reload();
    await expect(page.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    let releaseWrite = () => undefined as void;
    const heldWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
    await page.route("**/api/v1/display/occurrences/**/status", async (route) => {
      await heldWrite;
      await route.continue();
    });
    const done = await revealStep(page, JORDAN_ID, `Mark ${onlyStep} done`);
    await expect(done).toBeVisible();
    await done.click();
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toBeVisible();
    await expect(done).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    await expect(page.getByTestId(`family-next-${JORDAN_ID}`)).toContainText(onlyStep);
    await clickFamilyControl(page, `family-upcoming-${AVERY_ID}`);
    await clickFamilyControl(page, `family-upcoming-${JORDAN_ID}`);
    await expect(page.getByTestId(`family-next-${JORDAN_ID}`)).toContainText(onlyStep);
    const pane = page.getByTestId(`family-pane-${JORDAN_ID}`);
    await expect(pane.locator("[data-testid^='family-work-']")).toHaveCount(0);
    const nextDay = await fetchPersonDay(page, JORDAN_ID);
    const following = nextDay.occurrences.find((row) => row.title === `Next after pending ${stamp}`);
    expect(following).toBeTruthy();
    await clickFamilyControl(page, `family-heading-${following!.id}`);
    await expect(pane.locator("[data-testid^='family-work-']")).toHaveCount(1);
    await expect(page.getByTestId(`family-next-${JORDAN_ID}`)).toContainText(onlyStep);
    releaseWrite();
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId(`family-next-${JORDAN_ID}`)).toContainText(`Following step ${stamp}`, { timeout: 20_000 });
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "upcoming");
    const previous = nextDay.occurrences.find((row) => row.title === `Pending ${stamp}`);
    expect(previous).toBeTruthy();
    await clickFamilyControl(page, `family-earlier-${JORDAN_ID}`);
    await clickFamilyControl(page, `family-heading-${previous!.id}`);
    const reopen = pane.getByRole("button", { name: `Mark ${onlyStep} done` }).first();
    await expect(reopen).toHaveAttribute("aria-pressed", "true");
    await reopen.click();
    await expect.poll(async () => (await fetchPersonDay(page, JORDAN_ID)).occurrences
      .find((row) => row.id === previous!.id)?.steps.find((row) => row.text === onlyStep)?.status).toBe("open");
    await reopen.click();
    await expect.poll(async () => (await fetchPersonDay(page, JORDAN_ID)).occurrences
      .find((row) => row.id === previous!.id)?.steps.find((row) => row.text === onlyStep)?.status).toBe("completed");
    await clickFamilyControl(page, `family-back-next-${JORDAN_ID}`);
    await expect(page.getByTestId(`family-next-${JORDAN_ID}`)).toContainText(`Following step ${stamp}`);
    await page.unroute("**/api/v1/display/occurrences/**/status");
    await page.route("**/api/v1/display/occurrences/**/status", (route) => route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "CONFLICT", message: "Structure changed" }),
    }));
    await clickFamilyControl(page, `family-back-next-${JORDAN_ID}`);
    await pane.getByRole("button", { name: `Mark Following step ${stamp} done` }).click();
    await expect(page.getByTestId(`family-error-${JORDAN_ID}`)).toBeVisible();
    await expect(page.getByTestId(`family-next-${JORDAN_ID}`)).toContainText(`Following step ${stamp}`);
    await expect(pane.locator("[data-testid^='family-work-']")).toHaveCount(0);
  });

  test("AT1b: returning to expired panes reauthorizes them", async ({ page, request }) => {
    await page.addInitScript(() => { window.__HD_DISPLAY_PANE_STALE_MS = 1500; window.__HD_DISPLAY_NOW_MS = 10_000; });
    await ensureManagerSession(request);
    await enrollWall(request, page, `Return ${Date.now().toString(36)}`);
    const pane = page.getByTestId(`family-pane-${AVERY_ID}`);
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await clickFamilyControl(page, `family-upcoming-${AVERY_ID}`);
    const oldBody = await (await page.request.get(`/api/v1/display/people/${AVERY_ID}/day`)).text();
    const old = await armHeld(page, `**/api/v1/display/people/${AVERY_ID}/day`, oldBody);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await old.captured;
    await page.getByTestId("display-org-by-work").click();
    const pauseNew = async (route: Route) => { await route.abort(); };
    const dayMatcher = (url: URL) => url.pathname.endsWith(`/api/v1/display/people/${AVERY_ID}/day`);
    await page.route(dayMatcher, pauseNew);
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 11_501; });
    await expect(page.getByTestId(`family-blank-${AVERY_ID}`)).toBeAttached();
    await page.unroute(dayMatcher, pauseNew);
    const fresh = page.waitForResponse((response) => response.url().includes(`/api/v1/display/people/${AVERY_ID}/day`) && response.ok());
    await page.getByTestId("display-org-by-person").click();
    await fresh;
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await expect(pane).toHaveAttribute("data-section", "upcoming");
    await old.release();
    await old.delivered;
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await clickFamilyControl(page, `family-personal-${AVERY_ID}`);
    await expect(page.getByTestId("display-detail")).toBeVisible();
    await page.route(dayMatcher, pauseNew);
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 13_100; });
    await expect(pane).toHaveAttribute("data-phase", "blank");
    await page.unroute(dayMatcher, pauseNew);
    const afterDetail = page.waitForResponse((response) => response.url().includes(`/api/v1/display/people/${AVERY_ID}/day`) && response.ok());
    await page.getByRole("button", { name: "Back" }).click();
    await afterDetail;
    await expect(pane).toHaveAttribute("data-phase", "ready");
    await expect(pane).toHaveAttribute("data-section", "upcoming");
  });

  test("AT6a/AT15b: settlement preserves the focused action identity", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("webkit"), "Chromium establishes held-write races");
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    const first = `Focused first ${stamp}`;
    const next = `Focused next ${stamp}`;
    await createAssignedRoutine(request, { title: first, memberId: JORDAN_ID, daypart: "morning", steps: [{ text: first }] });
    await createAssignedRoutine(request, { title: next, memberId: JORDAN_ID, daypart: "after_school", steps: [{ text: next }] });
    await enrollWall(request, page, first);
    await completeOtherOccurrences(page, JORDAN_ID, [first, next]);
    await page.reload();
    const pane = page.getByTestId(`family-pane-${JORDAN_ID}`);
    await expect(page.getByTestId(`family-next-${JORDAN_ID}`)).toContainText(first);
    let release = () => undefined as void;
    let entered = () => undefined as void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const captured = new Promise<void>((resolve) => { entered = resolve; });
    await page.route("**/api/v1/display/occurrences/**/status", async (route) => { entered(); await hold; await route.continue(); });
    const action = pane.getByRole("button", { name: `Mark ${first} done` }).first();
    await action.focus();
    await page.keyboard.press("Enter");
    await captured;
    release();
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toHaveCount(0, { timeout: 20_000 });
    await expect(action).toBeFocused();
    await expect(action).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`family-next-${JORDAN_ID}`)).toContainText(first);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await fetchPersonDay(page, JORDAN_ID)).occurrences.find((row) => row.title === next)?.steps[0]?.status).toBe("open");
    await page.unrouteAll({ behavior: "wait" });
    await expect(action).toHaveAttribute("aria-pressed", "false");
    let releasePointer = () => undefined as void;
    let enteredPointer = () => undefined as void;
    const pointerHold = new Promise<void>((resolve) => { releasePointer = resolve; });
    const pointerCaptured = new Promise<void>((resolve) => { enteredPointer = resolve; });
    await page.route("**/api/v1/display/occurrences/**/status", async (route) => { enteredPointer(); await pointerHold; await route.continue(); });
    await page.keyboard.press("Enter");
    await pointerCaptured;
    const box = await action.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    releasePointer();
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId(`family-next-${JORDAN_ID}`)).toContainText(first);
    await page.mouse.move(box!.x + box!.width + 30, box!.y + box!.height + 30);
    await page.mouse.up();
    await clickFamilyControl(page, `family-back-next-${JORDAN_ID}`);
    await expect(page.getByTestId(`family-next-${JORDAN_ID}`)).toContainText(next);
    await expect.poll(async () => (await fetchPersonDay(page, JORDAN_ID)).occurrences.find((row) => row.title === next)?.steps[0]?.status).toBe("open");
    await page.unrouteAll({ behavior: "wait" });
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
    await jordanDone.click();
    await expect(page.getByTestId(`family-error-${JORDAN_ID}`)).toBeVisible({ timeout: 20_000 });
    await clickFamilyControl(page, `family-upcoming-${AVERY_ID}`);
    await expect(page.getByTestId(`family-error-${JORDAN_ID}`)).toBeVisible();
    await page.getByTestId("display-org-by-work").click();
    await expect(page.getByTestId("display-by-work")).toBeVisible();
    await expect(page.getByTestId(`family-overview-error-${JORDAN_ID}`)).toBeVisible();
    await page.getByTestId(`family-overview-return-${JORDAN_ID}`).click();
    await expect(page.getByTestId("display-org-by-person")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`family-error-${JORDAN_ID}`)).toBeVisible();
    await jordanDone.click();
    await expect(page.getByTestId(`family-error-${JORDAN_ID}`)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("display-retired-notices")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(async () => {
      const day = await fetchPersonDay(page, JORDAN_ID);
      return day.occurrences.find((row) => row.id === rejectOcc!.id)?.steps.find((step) => step.text === failText)?.status;
    }).toBe("completed");

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
    await averyDone.click();
    await averyDone.click();
    releaseDone();
    await expect(averyDone).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
    await expect(page.getByTestId(`family-pending-${AVERY_ID}`)).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(async () => {
      const day = await fetchPersonDay(page, AVERY_ID);
      return day.occurrences.find((row) => row.title === `Race step ${stamp}`)
        ?.steps.find((step) => step.text === toggleText)?.status;
    }, { timeout: 20_000 }).toBe("open");
    const raceDay = await fetchPersonDay(page, AVERY_ID);
    const raceOccurrence = raceDay.occurrences.find((row) => row.title === `Race step ${stamp}`)!;
    const raceStep = raceOccurrence.steps.find((step) => step.text === toggleText)!;
    await expect.poll(async () => (await displayOutboxItems(page)).filter((item) =>
      item.occurrenceId === raceOccurrence.id && item.stepId === raceStep.id,
    )).toEqual([]);
  });

  test("AT8a/AT9a/AT9b: cold offline has no household payload; live and reconnect preserve sibling position", async ({
    page,
    request,
    browser,
  }) => {
    const sockets: WebSocket[] = [];
    page.on("websocket", (socket) => {
      if (socket.url().includes("/api/v1/display/sync")) sockets.push(socket);
    });
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
    const remoteContext = await browser.newContext();
    const remoteWall = await remoteContext.newPage();
    await enrollWall(request, remoteWall, `Remote wall ${stamp}`);
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
    await completeDisplayStep(remoteWall, averyOcc!, liveStep!.id);
    await clickFamilyControl(page, `family-earlier-${AVERY_ID}`);
    await expect(page.getByTestId(`family-heading-${averyOcc!.id}`)).toBeVisible({ timeout: 20_000 });
    await clickFamilyControl(page, `family-heading-${averyOcc!.id}`);
    await expect(page.getByTestId(`display-step-done-${liveStep!.id}`).last()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute(
      "data-section",
      "upcoming",
    );

    await expect.poll(() => sockets.some((socket) => !socket.isClosed())).toBe(true);
    const activeSocket = sockets.findLast((socket) => !socket.isClosed());
    expect(activeSocket).toBeTruthy();
    const socketClosed = new Promise<void>((resolve) => { activeSocket!.on("close", () => resolve()); });
    await page.context().setOffline(true);
    await page.evaluate(() => {
      window.__HD_DISPLAY_CLOSE_SYNC__?.();
    });
    await socketClosed;
    const missedTitle = `Missed ${stamp}`;
    await createAssignedRoutine(request, {
      title: missedTitle,
      memberId: AVERY_ID,
      steps: [{ text: "Missed step" }],
    });
    const remoteDay = await fetchPersonDay(remoteWall, AVERY_ID);
    expect(remoteDay.occurrences.some((row) => row.title === missedTitle)).toBe(true);
    await expect(page.getByText(missedTitle)).toHaveCount(0);
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-section", "upcoming");
    await page.context().setOffline(false);
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

    const queuedMutationIds: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/steps/") && req.url().endsWith("/status")) {
        const body = req.postDataJSON() as { mutationId: string };
        queuedMutationIds.push(body.mutationId);
      }
    });
    await page.unroute("**/api/v1/display/occurrences/**/status").catch(() => undefined);
    await page.route("**/api/v1/display/occurrences/**/status", async (route) => {
      await route.abort();
    });
    const queued = await revealStep(page, JORDAN_ID, "Mark Jordan live done");
    await expect(queued).toBeVisible();
    await queued.click();
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toBeVisible();
    await expect.poll(async () => (await displayOutboxItems(page)).filter((item) =>
      item.mutationId === queuedMutationIds[0],
    ).length).toBe(1);
    const persisted = (await displayOutboxItems(page)).find((item) => item.mutationId === queuedMutationIds[0])!;
    expect(JSON.stringify(persisted)).not.toContain(`Jordan live ${stamp}`);
    expect(JSON.stringify(persisted)).not.toContain("Jordan live");
    await page.route("**/api/v1/display/**", async (route) => {
      await route.abort();
    });
    await page.reload();
    await expect(page.getByTestId("family-board")).toHaveCount(0);
    await expect(page.getByText(title)).toHaveCount(0);
    await page.unroute("**/api/v1/display/**");
    await page.unroute("**/api/v1/display/occurrences/**/status");
    await page.reload();
    await expect(page.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(async () => {
      const day = await fetchPersonDay(page, JORDAN_ID);
      return day.occurrences.find((row) => row.title === `Jordan live ${stamp}`)
        ?.steps.find((step) => step.text === "Jordan live")?.status;
    }, { timeout: 20_000 }).toBe("completed");
    expect(queuedMutationIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(queuedMutationIds).size).toBe(1);
    await expect.poll(async () => (await displayOutboxItems(page)).filter((item) =>
      item.mutationId === queuedMutationIds[0],
    )).toEqual([]);
    await remoteContext.close();
  });

  test("AT10a: hung person-day expires only that pane while siblings stay ready", async ({
    page,
    request,
  }) => {
    await page.addInitScript(() => {
      window.__HD_DISPLAY_PANE_STALE_MS = 2000;
      window.__HD_DISPLAY_NOW_MS = 10_000;
    });
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    await createAssignedRoutine(request, {
      title: `Hung ${stamp}`,
      memberId: AVERY_ID,
      steps: [{ text: "Hung step" }],
    });
    await createAssignedRoutine(request, {
      title: `Healthy ${stamp}`,
      memberId: JORDAN_ID,
      steps: [{ text: "Healthy step" }],
    });
    await enrollWall(request, page, `Hung ${stamp}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready", {
      timeout: 20_000,
    });
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-phase", "ready");
    const oldBody = await (await page.request.get(`/api/v1/display/people/${AVERY_ID}/day`)).text();
    let releaseHung = () => undefined as void;
    let capturedHung = () => undefined as void;
    const captured = new Promise<void>((resolve) => { capturedHung = resolve; });
    let heldCount = 0;
    let deliveredCount = 0;
    let releaseFresh = () => undefined as void;
    const freshHold = new Promise<void>((resolve) => { releaseFresh = resolve; });
    const hung = new Promise<void>((resolve) => {
      releaseHung = resolve;
    });
    await page.route(`**/api/v1/display/people/${AVERY_ID}/day`, async (route) => {
      heldCount += 1;
      if (heldCount > 2) {
        await freshHold;
        await route.continue();
        return;
      }
      capturedHung();
      await hung;
      await route.fulfill({ status: 200, contentType: "application/json", body: oldBody });
      deliveredCount += 1;
    });
    const siblingRefresh = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/display/people/${JORDAN_ID}/day`) && response.ok());
    await page.evaluate(() => {
      window.__HD_DISPLAY_NOW_MS = 11_000;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await captured;
    await siblingRefresh;
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready");
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-phase", "ready");
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => heldCount).toBeGreaterThanOrEqual(2);
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 12_001; });
    await page.waitForTimeout(700);
    await expect(page.getByTestId(`family-blank-${AVERY_ID}`)).toBeVisible();
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-phase", "ready");
    const siblingPane = page.getByTestId(`family-pane-${JORDAN_ID}`);
    const siblingDone = siblingPane.locator("[data-testid^='display-step-done-']").first();
    await expect(siblingDone).toBeVisible();
    const siblingDoneId = await siblingDone.getAttribute("data-testid");
    expect(siblingDoneId).toBeTruthy();
    await siblingPane.getByTestId(siblingDoneId!).click();
    await expect.poll(async () => (await fetchPersonDay(page, JORDAN_ID)).occurrences
      .flatMap((occurrence) => occurrence.steps)
      .find((step) => step.id === siblingDoneId!.replace("display-step-done-", ""))?.status,
    { timeout: 15_000 }).toBe("completed");
    await expect(siblingPane).toHaveAttribute("data-phase", "ready");
    releaseHung();
    await expect.poll(() => deliveredCount).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId(`family-blank-${AVERY_ID}`)).toBeVisible();
    releaseFresh();
    // A queued refresh may already be the fresh retry after the held bodies
    // are released; it must be able to restore this pane.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready", { timeout: 15_000 });
    await page.unrouteAll({ behavior: "wait" });
  });

  test("AT10a/AT10b/AT11b/AT11c: stale pane lease, old snapshot, and lost enlargement cannot paint", async ({
    page,
    request,
  }) => {
    await page.addInitScript(() => {
      window.__HD_DISPLAY_PANE_STALE_MS = 1500;
      window.__HD_DISPLAY_NOW_MS = 10_000;
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
    const siblingRefresh = page.waitForResponse((response) => response.url().includes(`/api/v1/display/people/${JORDAN_ID}/day`) && response.ok());
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 11_000; document.dispatchEvent(new Event("visibilitychange")); });
    await siblingRefresh;
    await page.waitForTimeout(100);
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 11_501; });
    await page.waitForTimeout(700);
    await expect(page.getByTestId(`family-blank-${AVERY_ID}`)).toBeVisible();
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-phase", "ready");

    await page.evaluate(() => {
      window.__HD_DISPLAY_NOW_MS = 11_600;
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
    await clickFamilyControl(page, `family-earlier-${AVERY_ID}`);
    await expect(page.getByTestId(`family-heading-${original!.id}`)).toBeVisible({ timeout: 20_000 });
    await clickFamilyControl(page, `family-heading-${original!.id}`);
    const originalDone = page.getByTestId(`display-step-done-${originalStep!.id}`).last();
    await expect(originalDone).toHaveAttribute("aria-pressed", "true");
    const heldOld = await armHeld(page, `**/api/v1/display/people/${AVERY_ID}/day`, oldBody);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await heldOld.captured;
    const newerDay = page.waitForResponse((response) => response.url().includes(`/api/v1/display/people/${AVERY_ID}/day`) && response.ok());
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await newerDay;
    await expect(originalDone).toHaveAttribute("aria-pressed", "true");
    await heldOld.release();
    await heldOld.delivered;
    await expect(originalDone).toHaveAttribute("aria-pressed", "true");

    await page.unroute(`**/api/v1/display/people/${AVERY_ID}/day`);
    const currentBody = await (await page.request.get(`/api/v1/display/people/${AVERY_ID}/day`)).text();
    const heldLate = await armHeld(page, `**/api/v1/display/people/${AVERY_ID}/day`, currentBody);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await heldLate.captured;
    await page.evaluate(() => {
      window.__HD_DISPLAY_NOW_MS = 13_101;
    });
    await heldLate.release();
    await expect(page.getByTestId(`family-blank-${AVERY_ID}`)).toBeVisible();

    let releaseRecovery = () => undefined as void;
    const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const averyDayMatcher = (url: URL) => url.pathname.endsWith(`/api/v1/display/people/${AVERY_ID}/day`);
    const holdRecovery = async (route: Route) => { await recoveryGate; await route.continue(); };
    await page.route(averyDayMatcher, holdRecovery);
    await page.unroute(`**/api/v1/display/people/${AVERY_ID}/day`);
    await clickFamilyControl(page, `family-retry-${AVERY_ID}`);
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 13_200; });
    releaseRecovery();
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready", {
      timeout: 15_000,
    });
    await page.unrouteAll({ behavior: "wait" });

    const refreshedSibling = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/display/people/${JORDAN_ID}/day`) && response.ok(),
    );
    await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await refreshedSibling;
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-phase", "ready");

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
    await page.getByRole("button", { name: "Back" }).click();
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
    const revocationTitle = `Revoke pending ${stamp}`;
    await createAssignedRoutine(request, { title: revocationTitle, memberId: AVERY_ID, steps: [{ text: `Revoke step ${stamp}` }] });
    const displayId = await enrollWall(request, page, `Withdraw ${stamp}`);
    await completeOtherOccurrences(page, AVERY_ID, revocationTitle);
    await page.reload();
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready");
    await expect(page.getByText(title)).toBeVisible();
    const managerId = "22222222-2222-4222-8222-222222222201";
    const oldDay = await page.request.get(`/api/v1/display/people/${managerId}/day`);
    expect(oldDay.ok()).toBeTruthy();
    const heldPromoted = await armHeld(page, `**/api/v1/display/people/${managerId}/day`, await oldDay.text());
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await heldPromoted.captured;
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
    await heldPromoted.release();
    await heldPromoted.delivered;
    await expect(page.getByText(title)).toHaveCount(0);
    const withdrawn = (await sharing.json()) as { task: { sharingVersion: number } };
    const repromote = await request.post(`/api/v1/personal-tasks/${task.task.id}/sharing`, {
      headers: await csrfHeaders(request),
      data: { mutationId: crypto.randomUUID(), visibility: "household", showOnSharedDashboard: true, expectedSharingVersion: withdrawn.task.sharingVersion },
    });
    expect(repromote.ok(), await repromote.text()).toBeTruthy();
    await expect(page.getByText(title)).toBeVisible({ timeout: 20_000 });
    await page.route("**/api/v1/display/occurrences/**/status", (route) => route.abort());
    await page.getByRole("button", { name: `Mark Revoke step ${stamp} done` }).click();
    await expect(page.getByTestId(`family-pending-${AVERY_ID}`)).toBeVisible();
    const dashboardBeforeRevoke = await page.request.get("/api/v1/display/dashboard");
    expect(dashboardBeforeRevoke.ok()).toBeTruthy();
    const heldDashboard = await armHeld(page, "**/api/v1/display/dashboard", await dashboardBeforeRevoke.text());
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await heldDashboard.captured;

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
    await heldDashboard.release();
    await heldDashboard.delivered;
    await expect(page.getByTestId("family-board")).toHaveCount(0);
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
    await done.click();
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
    await page.route("**/api/v1/display/occurrences/**/status", (route) => route.abort());
    const pendingDone = await revealStep(page, AVERY_ID, `Mark ${stamp} done later done`);
    await pendingDone.click();
    await expect(page.getByTestId(`family-pending-${AVERY_ID}`)).toBeVisible();
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
    await expect(page.getByTestId(`family-pending-${AVERY_ID}`)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("display-retired-notices")).toBeVisible();
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
