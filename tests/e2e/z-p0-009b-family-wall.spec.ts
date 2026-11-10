import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { touchDragByCdp } from "../helpers/touch-drag";
import { wipeSeededE2eServer } from "../helpers/e2e-restart-server";
import {
  PEOPLE,
  AVERY_ID,
  JORDAN_ID,
  csrfHeaders,
  enrollWall,
  ensureManagerSession,
  householdDate,
  createAssignedRoutine,
  completeDisplayStep,
  completeOtherOccurrences,
  fetchPersonDay,
  clickFamilyControl,
  restoreSeedPeople,
  waitForReadyPanes,
  assertVisibleInClippingAncestors,
  assertNonOverlappingHits,
} from "../helpers/p0-009b";

async function ensureCrowdedWork(request: Parameters<typeof ensureManagerSession>[0]) {
  await restoreSeedPeople(request);
  await ensureManagerSession(request);
  const stamp = Date.now().toString(36);
  for (const person of PEOPLE) {
    await createAssignedRoutine(request, {
      title: person.id === AVERY_ID ? `Morning ${stamp}` : `Board ${stamp} ${person.name}`,
      memberId: person.id,
      steps:
        person.id === AVERY_ID
          ? [
              { text: `Get dressed ${stamp}` },
              { text: `Brush teeth ${stamp}` },
              {
                text: "Pack the unusually long backpack checklist including library books and permission slip",
              },
              { text: "Shoes on" },
              { text: "Out the door" },
            ]
          : [{ text: `Next step for ${person.name}` }],
    });
  }
  for (const [title, daypart] of [
    [`Homework time ${stamp}`, "after_school"],
    [`House cleaning ${stamp}`, "after_school"],
    [`Dinner cleanup ${stamp}`, "evening"],
    [`Bedtime ${stamp}`, "evening"],
    [`Pet work ${stamp}`, "anytime"],
  ] as const) {
    await createAssignedRoutine(request, {
      title,
      memberId: AVERY_ID,
      daypart,
      steps: [{ text: `${title} step` }],
    });
  }
  const composed = await request.post("/api/v1/responsibilities", {
    headers: await csrfHeaders(request),
    data: {
      mutationId: crypto.randomUUID(), title: `Scheduled extras ${stamp}`, daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: { mode: "fixed", anchorDate: await householdDate(request), fixedMemberId: AVERY_ID },
      steps: [{ logicalItemId: crypto.randomUUID(), text: `Base extra ${stamp}`, obligation: "required" }],
      scheduledAdditions: [{ name: `Deep clean ${stamp}`, weekdays: [1, 2, 3, 4, 5, 6, 7], inheritAssignment: true, steps: [{ logicalItemId: crypto.randomUUID(), text: `Scheduled extra ${stamp}`, obligation: "required" }] }],
    },
  });
  expect(composed.ok(), await composed.text()).toBeTruthy();
  const asNeededText = `Sweep if dusty ${stamp}`;
  await createAssignedRoutine(request, {
    title: `As needed ${stamp}`,
    memberId: JORDAN_ID,
    steps: [
      { text: `Be present ${stamp}` },
      { text: asNeededText, obligation: "as_needed" },
    ],
  });
  return { stamp, asNeededText };
}

async function markAveryMorningProgress(page: Parameters<typeof fetchPersonDay>[0], stamp: string) {
  const personDay = await fetchPersonDay(page, AVERY_ID);
  const morning = personDay.occurrences.find((row) =>
    row.steps.some((step) => step.text === `Get dressed ${stamp}`),
  );
  expect(morning?.intendedStructure).toBeTruthy();
  await completeOtherOccurrences(page, AVERY_ID, [
    morning!.title,
    `Homework time ${stamp}`,
    `House cleaning ${stamp}`,
    `Dinner cleanup ${stamp}`,
    `Bedtime ${stamp}`,
    `Pet work ${stamp}`,
    `Scheduled extras ${stamp}`,
  ]);
  for (const person of PEOPLE) {
    if (person.id === AVERY_ID) continue;
    await completeOtherOccurrences(
      page,
      person.id,
      person.id === JORDAN_ID
        ? [`Board ${stamp} ${person.name}`, `As needed ${stamp}`]
        : [`Board ${stamp} ${person.name}`],
    );
  }
  for (const step of morning.steps.slice(0, 2)) {
    if (step.status !== "open") continue;
    await completeDisplayStep(page, morning, step.id);
  }
}

test.describe("P0-009B family wall", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.title.includes("AT16a")) return;
    await page.setViewportSize({ width: 1920, height: 1080 });
  });

  test("AT1a/AT2a/AT4b/AT5a: default board, order, sibling isolation, Done", async ({
    page,
    request,
  }) => {
    const { stamp } = await ensureCrowdedWork(request);
    await enrollWall(request, page, `Family ${stamp}`);
    await expect(page.getByTestId("display-org-by-person")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("family-board")).toBeVisible();
    await expect(page.getByTestId("display-detail")).toHaveCount(0);
    await waitForReadyPanes(page, PEOPLE.map((person) => person.id));
    for (const person of PEOPLE) {
      await expect(page.getByTestId(`family-pane-${person.id}`)).toBeVisible();
    }
    const names = await page.locator(".family-board-pane .display-person-name").allTextContents();
    expect(names.slice(0, PEOPLE.length)).toEqual(PEOPLE.map((person) => person.name));

    const morning = (await fetchPersonDay(page, AVERY_ID)).occurrences.find((row) =>
      row.steps.some((step) => step.text === `Get dressed ${stamp}`),
    );
    expect(morning).toBeTruthy();
    await completeOtherOccurrences(page, AVERY_ID, morning!.title);
    const getDressed = morning!.steps.find((step) => step.text === `Get dressed ${stamp}`);
    expect(getDressed?.status).toBe("open");
    await completeDisplayStep(page, morning!, getDressed!.id);
    await page.reload();
    await expect(page.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    await waitForReadyPanes(page, PEOPLE.map((person) => person.id));
    const averyPane = page.getByTestId(`family-pane-${AVERY_ID}`);
    const averyDone = averyPane.getByRole("button", { name: `Mark Brush teeth ${stamp} done` });
    await expect(averyDone).toBeVisible();
    await expect(averyPane.getByTestId(`family-next-${AVERY_ID}`)).toContainText(
      `Brush teeth ${stamp}`,
    );
    const doneTestId = await averyDone.getAttribute("data-testid");
    expect(doneTestId).toBeTruthy();
    const jordanPane = page.getByTestId(`family-pane-${JORDAN_ID}`);
    await clickFamilyControl(jordanPane, `family-upcoming-${JORDAN_ID}`);
    await expect(jordanPane).toHaveAttribute("data-section", "upcoming");
    await averyDone.click();
    await expect(averyPane.locator(`[data-testid="${doneTestId}"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 15_000 },
    );
    await expect(jordanPane).toHaveAttribute("data-section", "upcoming");
    await page.getByTestId("display-org-by-work").click();
    await expect(page.getByTestId("display-by-work")).toBeVisible();
    await page.getByTestId("display-org-by-person").click();
    await expect(jordanPane).toHaveAttribute("data-section", "upcoming");
    const namesAfter = await page.locator(".family-board-pane .display-person-name").allTextContents();
    expect(namesAfter.slice(0, PEOPLE.length)).toEqual(PEOPLE.map((person) => person.name));
  });

  test("AT3a: started later stays next after every step is reopened", async ({ page, request }) => {
    await restoreSeedPeople(request);
    const stamp = Date.now().toString(36);
    await createAssignedRoutine(request, {
      title: `Early unstarted ${stamp}`,
      memberId: AVERY_ID,
      daypart: "morning",
      steps: [{ text: `Morning first ${stamp}` }],
    });
    await createAssignedRoutine(request, {
      title: `Later started ${stamp}`,
      memberId: AVERY_ID,
      daypart: "after_school",
      steps: [{ text: `Later first ${stamp}` }, { text: `Later second ${stamp}` }],
    });
    await enrollWall(request, page, `Started ${stamp}`);
    await waitForReadyPanes(page, [AVERY_ID]);
    await completeOtherOccurrences(page, AVERY_ID, [
      `Early unstarted ${stamp}`,
      `Later started ${stamp}`,
    ]);
    const day = await fetchPersonDay(page, AVERY_ID);
    const later = day.occurrences.find((row) => row.title === `Later started ${stamp}`);
    const first = later?.steps.find((step) => step.text === `Later first ${stamp}`);
    expect(later?.intendedStructure).toBeTruthy();
    expect(first).toBeTruthy();
    await completeDisplayStep(page, later!, first!.id);
    await completeDisplayStep(page, later!, first!.id, "open");
    const afterUndo = await fetchPersonDay(page, AVERY_ID);
    const laterAfter = afterUndo.occurrences.find((row) => row.title === `Later started ${stamp}`);
    expect(laterAfter?.steps.every((step) => step.status === "open")).toBe(true);
    expect(Boolean(laterAfter?.startedAt) || laterAfter?.state === "In progress").toBe(true);
    await page.reload();
    await waitForReadyPanes(page, [AVERY_ID]);
    const next = page.getByTestId(`family-next-${AVERY_ID}`);
    await expect(next).toContainText(`Later first ${stamp}`);
    await expect(next).not.toContainText(`Morning first ${stamp}`);
    await expect(page.getByTestId(`family-current-${AVERY_ID}`)).toContainText(
      `Later started ${stamp}`,
    );
  });

  test("AT3b: a filtered school checklist is not shown as no assigned work", async ({ page, request }, testInfo) => {
    expect(testInfo.project.use.baseURL).toBeTruthy();
    await wipeSeededE2eServer(testInfo.project.use.baseURL!);
    await ensureManagerSession(request);
    const today = await householdDate(request);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
    const year = today.slice(0, 4);
    const calendar = await request.put("/api/v1/school-calendar", {
      headers: await csrfHeaders(request),
      data: { mutationId: crypto.randomUUID(), expectedVersion: 0, years: [{ startDate: `${year}-01-01`, endDate: `${year}-12-31`, usualWeekdays: [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== weekday), exceptions: [] }] },
    });
    expect(calendar.ok(), await calendar.text()).toBeTruthy();
    const routine = await request.post("/api/v1/routines", {
      headers: await csrfHeaders(request),
      data: { mutationId: crypto.randomUUID(), title: "School only", daypart: "morning", weekdays: [1, 2, 3, 4, 5, 6, 7], assigneeMemberIds: [AVERY_ID], assigneeGroupIds: [], steps: [{ logicalItemId: crypto.randomUUID(), text: "Pack for school", obligation: "required", applicability: { kind: "school_days" } }] },
    });
    expect(routine.ok(), await routine.text()).toBeTruthy();
    await enrollWall(request, page, `Filtered ${Date.now()}`);
    const filtered = page.getByTestId(`family-empty-${AVERY_ID}`);
    await expect(filtered).toHaveAttribute("data-empty-kind", "filtered-omission", { timeout: 20_000 });
    await expect(filtered).toHaveText("Nothing on the board today");
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).not.toContainText("No assigned work today");
    await expect(page.getByTestId(`family-empty-${JORDAN_ID}`)).toHaveAttribute("data-empty-kind", "no-work");
    await page.close();
    await wipeSeededE2eServer(testInfo.project.use.baseURL!);
  });

  test("AT3c: optional work remains reachable after required work is complete", async ({ page, request }) => {
    await ensureManagerSession(request);
    const stamp = Date.now().toString(36);
    const title = `Optional ${stamp}`;
    await createAssignedRoutine(request, { title, memberId: AVERY_ID, steps: [{ text: `Required ${stamp}` }, { text: `Optional ${stamp}`, obligation: "optional" }] });
    await enrollWall(request, page, `Optional ${stamp}`);
    await completeOtherOccurrences(page, AVERY_ID, title);
    const day = await fetchPersonDay(page, AVERY_ID);
    const occurrence = day.occurrences.find((row) => row.title === title);
    const required = occurrence?.steps.find((step) => step.text === `Required ${stamp}`);
    expect(occurrence).toBeTruthy();
    expect(required).toBeTruthy();
    await completeDisplayStep(page, occurrence!, required!.id);
    await page.reload();
    await expect(page.getByTestId(`family-empty-${AVERY_ID}`)).toHaveAttribute("data-empty-kind", "complete-optional", { timeout: 20_000 });
    await clickFamilyControl(page, `family-earlier-${AVERY_ID}`);
    await clickFamilyControl(page, `family-heading-${occurrence!.id}`);
    await expect(page.getByRole("button", { name: `Mark Optional ${stamp} done` })).toBeVisible();
  });

  test("AT15c/AT16b: enlarge return and keyboard; touch does not complete", async ({
    page,
    request,
    browserName,
  }) => {
    await ensureCrowdedWork(request);
    await enrollWall(request, page, `Enlarge ${Date.now().toString(36)}`);
    await waitForReadyPanes(page, PEOPLE.map((person) => person.id));
    const averyPane = page.getByTestId(`family-pane-${AVERY_ID}`);
    await clickFamilyControl(page, `family-upcoming-${AVERY_ID}`);
    await expect(averyPane).toHaveAttribute("data-section", "upcoming");
    await clickFamilyControl(page, `family-enlarge-${AVERY_ID}`);
    await expect(averyPane).toHaveClass(/enlarged/);
    await expect(averyPane).toHaveAttribute("data-section", "upcoming");
    await clickFamilyControl(page, `family-back-${AVERY_ID}`);
    await expect(page.getByTestId(`family-enlarge-${AVERY_ID}`)).toBeFocused();
    await expect(averyPane).toHaveAttribute("data-section", "upcoming");
    await clickFamilyControl(page, `family-back-next-${AVERY_ID}`);
    await expect(averyPane).toHaveAttribute("data-section", "next");
    const done = averyPane
      .getByTestId(`family-current-${AVERY_ID}`)
      .locator("[data-testid^='display-step-done-']")
      .first();
    const doneTestId = await done.getAttribute("data-testid");
    expect(doneTestId).toBeTruthy();
    const doneButton = averyPane
      .getByTestId(`family-current-${AVERY_ID}`)
      .getByTestId(doneTestId!);
    await doneButton.focus();
    const before = await doneButton.getAttribute("aria-pressed");
    await doneButton.press("Enter");
    const acted = averyPane.getByTestId(doneTestId!).first();
    await expect(acted).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true", {
      timeout: 15_000,
    });
    await acted.focus();
    await acted.press("Enter");
    await expect(acted).toHaveAttribute("aria-pressed", before ?? "false", { timeout: 15_000 });
    if (browserName === "chromium") {
      const title = averyPane.locator(".display-work-title").first();
      const box = await title.boundingBox();
      expect(box).toBeTruthy();
      await touchDragByCdp(
        page,
        { x: box!.x + Math.min(8, box!.width / 2), y: box!.y + Math.min(8, box!.height / 2) },
        { x: box!.x + Math.min(8, box!.width / 2) + 12, y: box!.y + box!.height + 60 },
      );
    }
    await expect(doneButton).toHaveAttribute("aria-pressed", before ?? "false");
  });

  test("AT16a: six identities at native 3840 and 1920", async ({ page, request }, testInfo) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width < 1920, "native target viewport");
    expect(testInfo.project.use.baseURL).toBeTruthy();
    await wipeSeededE2eServer(testInfo.project.use.baseURL!);
    const { stamp } = await ensureCrowdedWork(request);
    await enrollWall(request, page, `Geom ${stamp}`);
    await markAveryMorningProgress(page, stamp);
    await page.reload();
    await expect(page.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    const longStep = "Pack the unusually long backpack checklist";
    async function assertSettledBoard() {
      await waitForReadyPanes(
        page,
        PEOPLE.map((person) => person.id),
      );
      const averyPane = page.getByTestId(`family-pane-${AVERY_ID}`);
      const next = averyPane.getByTestId(`family-next-${AVERY_ID}`);
      await expect(next).toContainText("2/5 done");
      await expect(next).toContainText(longStep);
      await assertVisibleInClippingAncestors(next);
      const action = averyPane.getByRole("button", {
        name: `Mark ${longStep} including library books and permission slip done`,
      });
      await expect(action).toBeVisible();
      await assertVisibleInClippingAncestors(action);
      await assertVisibleInClippingAncestors(averyPane.getByTestId(`family-more-${AVERY_ID}`));
      await assertNonOverlappingHits(averyPane.getByTestId(`family-current-${AVERY_ID}`));
        for (const person of PEOPLE) {
          const pane = page.getByTestId(`family-pane-${person.id}`);
          const instruction = pane.getByTestId(`family-next-${person.id}`);
          const target = pane.getByTestId(`family-current-${person.id}`)
            .locator("[data-testid^='display-step-done-']").first();
          await assertVisibleInClippingAncestors(instruction);
          await assertVisibleInClippingAncestors(target);
          const hit = await target.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            return { width: box.width, height: box.height, hit: top === node || node.contains(top) };
          });
          expect(hit.width).toBeGreaterThanOrEqual(48);
          expect(hit.height).toBeGreaterThanOrEqual(48);
          expect(hit.hit).toBe(true);
        }
      const metrics = await page.evaluate((ids: string[]) => {
        const doc = document.documentElement;
        const panes = ids.map((id) => {
          const box = document
            .querySelector(`[data-testid="family-pane-${id}"]`)
            ?.getBoundingClientRect();
          return box
            ? { id, top: box.top, bottom: box.bottom, height: box.height }
            : { id, top: -1, bottom: -1, height: 0 };
        });
        return {
          y: doc.scrollHeight - doc.clientHeight,
          x: doc.scrollWidth - doc.clientWidth,
          innerHeight: window.innerHeight,
          panes,
        };
      }, PEOPLE.map((person) => person.id));
      expect(metrics.y).toBeLessThan(8);
      expect(metrics.x).toBeLessThan(8);
      for (const pane of metrics.panes) {
        expect(pane.height).toBeGreaterThan(80);
        expect(pane.top).toBeGreaterThanOrEqual(-1);
        expect(pane.bottom).toBeLessThanOrEqual(metrics.innerHeight + 1);
      }
    }
    async function exerciseTouchHits() {
      await page.evaluate(() => {
        const state = window as unknown as { __hitLog: string[]; __hitCapture: (event: Event) => void };
        state.__hitLog = [];
        state.__hitCapture = (event: Event) => {
          const button = (event.target as Element).closest("[data-testid^='display-step-done-']");
          if (!button) return;
          state.__hitLog.push(button.getAttribute("data-testid") ?? "");
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        document.addEventListener("click", state.__hitCapture, true);
      });
      const cdp = await page.context().newCDPSession(page);
      const expected: string[] = [];
      for (const person of PEOPLE) {
        const target = page.getByTestId(`family-current-${person.id}`).locator("[data-testid^='display-step-done-']").first();
        const id = await target.getAttribute("data-testid");
        const box = await target.boundingBox();
        expect(id).toBeTruthy();
        expect(box).toBeTruthy();
        expected.push(id!);
        const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
      const actual = await page.evaluate(() => {
        const state = window as unknown as { __hitLog: string[]; __hitCapture: (event: Event) => void };
        document.removeEventListener("click", state.__hitCapture, true);
        return state.__hitLog;
      });
      expect(actual).toEqual(expected);
      await cdp.detach();
    }
    expect(page.viewportSize()?.width).toBe(3840);
    await assertSettledBoard();
    await expect(page.locator(".family-board-pane")).toHaveCount(6);
    fs.mkdirSync("reports/_local-screenshots/p0-009b-r2", { recursive: true });
    await page.screenshot({
      path: "reports/_local-screenshots/p0-009b-r2/3840x2160.png",
      fullPage: false,
    });
    await exerciseTouchHits();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await assertSettledBoard();
    await expect(page.locator(".family-board-pane")).toHaveCount(6);
    await page.screenshot({
      path: "reports/_local-screenshots/p0-009b-r2/1920x1080.png",
      fullPage: false,
    });
    await exerciseTouchHits();
    const extra = await request.post("/api/v1/people", {
      headers: await csrfHeaders(request),
      data: { mutationId: crypto.randomUUID(), displayName: `Overflow ${stamp}`, classification: "child" },
    });
    expect(extra.ok(), await extra.text()).toBeTruthy();
    const extraId = ((await extra.json()) as { person: { id: string } }).person.id;
    await expect(page.getByTestId(`family-pane-${extraId}`)).toBeAttached({ timeout: 20_000 });
    await expect(page.getByTestId(`family-pane-${extraId}`)).toHaveAttribute("data-phase", "ready", { timeout: 20_000 });
    await expect(page.locator(".family-board-pane")).toHaveCount(7);
    for (const width of [1920, 3840]) {
      await page.setViewportSize({ width, height: width * 9 / 16 });
      await assertSettledBoard();
      await page.screenshot({ path: `reports/_local-screenshots/p0-009b-r2/${width}-overflow.png`, fullPage: false });
      await exerciseTouchHits();
      await page.getByTestId(`family-pane-${extraId}`).scrollIntoViewIfNeeded();
      await expect(page.getByTestId(`family-pane-${extraId}`)).toBeVisible();
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    const composedDay = await fetchPersonDay(page, AVERY_ID);
    const composed = composedDay.occurrences.find((row) => row.title === `Scheduled extras ${stamp}`);
    expect(composed).toBeTruthy();
    await clickFamilyControl(page, `family-more-${AVERY_ID}`);
    await clickFamilyControl(page, `family-heading-${composed!.id}`);
    await expect(page.getByTestId(`family-work-${composed!.id}`)).toContainText(`Deep clean ${stamp}`);
    await clickFamilyControl(page, `family-back-next-${AVERY_ID}`);
    const averyPane = page.getByTestId(`family-pane-${AVERY_ID}`);
    const action = averyPane.getByTestId(`family-current-${AVERY_ID}`).getByRole("button", {
      name: `Mark ${longStep} including library books and permission slip done`,
    });
    const actionId = await action.getAttribute("data-testid");
    expect(actionId).toBeTruthy();
    await action.click();
    await expect(averyPane.getByTestId(actionId!).first()).toHaveAttribute("aria-pressed", "true", {
      timeout: 15_000,
    });
  });

  test("AT11a: one pane 5xx keeps sibling usable", async ({ page, request }) => {
    await ensureCrowdedWork(request);
    await enrollWall(request, page, `Fail ${Date.now().toString(36)}`);
    await waitForReadyPanes(page, PEOPLE.map((person) => person.id));
    let failAvery = true;
    await page.route(`**/api/v1/display/people/${AVERY_ID}/day`, async (route) => {
      if (failAvery) {
        await route.fulfill({ status: 500, body: JSON.stringify({ code: "INTERNAL" }) });
        return;
      }
      await route.continue();
    });
    await page.reload();
    await expect(page.getByTestId(`family-unavailable-${AVERY_ID}`)).toBeVisible({
      timeout: 20_000,
    });
    const sibling = page.getByTestId(`family-pane-${PEOPLE[0].id}`);
    await expect(sibling).toBeVisible();
    await expect(sibling.getByTestId(`family-unavailable-${PEOPLE[0].id}`)).toHaveCount(0);
    await expect(sibling).toHaveAttribute("data-phase", "ready");
    await clickFamilyControl(sibling, `family-upcoming-${PEOPLE[0].id}`);
    await expect(sibling).toHaveAttribute("data-section", "upcoming");
    const siblingDone = sibling.locator("[data-testid^='display-step-done-']").first();
    await expect(siblingDone).toBeVisible();
    const siblingDoneId = await siblingDone.getAttribute("data-testid");
    expect(siblingDoneId).toBeTruthy();
    await sibling.getByTestId(siblingDoneId!).click();
    await expect(sibling.getByTestId(siblingDoneId!)).toHaveAttribute("aria-pressed", "true", {
      timeout: 15_000,
    });
    await expect(sibling.getByTestId(`family-pending-${PEOPLE[0].id}`)).toHaveCount(0, { timeout: 20_000 });
    await expect(sibling).toHaveAttribute("data-section", "upcoming");
    const stepId = siblingDoneId!.replace("display-step-done-", "");
    await expect.poll(async () => (await fetchPersonDay(page, PEOPLE[0].id)).occurrences
      .flatMap((occurrence) => occurrence.steps)
      .find((step) => step.id === stepId)?.status).toBe("completed");
    failAvery = false;
    await clickFamilyControl(page, `family-retry-${AVERY_ID}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready", {
      timeout: 15_000,
    });
  });

  test("AT2b/AT3b/AT4a/AT5b/AT12: overflow, empty state, timeline, Not needed, Needs an owner", async ({
    page,
    request,
  }) => {
    const { stamp, asNeededText } = await ensureCrowdedWork(request);
    const extra = await request.post("/api/v1/people", {
      headers: await csrfHeaders(request),
      data: {
        mutationId: crypto.randomUUID(),
        displayName: `Quinn ${stamp}`,
        classification: "child",
      },
    });
    expect(extra.ok(), await extra.text()).toBeTruthy();
    const quinnId = ((await extra.json()) as { person: { id: string } }).person.id;
    await createAssignedRoutine(request, {
      title: `Quinn board ${stamp}`,
      memberId: quinnId,
      steps: [{ text: "Quinn next" }],
    });
    const emptyPerson = await request.post("/api/v1/people", {
      headers: await csrfHeaders(request),
      data: {
        mutationId: crypto.randomUUID(),
        displayName: `Riley ${stamp}`,
        classification: "child",
      },
    });
    expect(emptyPerson.ok(), await emptyPerson.text()).toBeTruthy();
    const rileyId = ((await emptyPerson.json()) as { person: { id: string } }).person.id;
    const unassignedTitle = `Needs owner ${stamp}`;
    const group = await request.post("/api/v1/groups", {
      headers: await csrfHeaders(request),
      data: {
        mutationId: crypto.randomUUID(),
        name: `Empty ring ${stamp}`,
        membershipIds: [AVERY_ID],
      },
    });
    expect(group.ok(), await group.text()).toBeTruthy();
    const groupId = ((await group.json()) as { group: { id: string } }).group.id;
    const unassigned = await request.post("/api/v1/responsibilities", {
      headers: await csrfHeaders(request),
      data: {
        mutationId: crypto.randomUUID(),
        title: unassignedTitle,
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "take_turns",
          anchorDate: await householdDate(request),
          sourceGroupId: groupId,
          savedRingOrder: [AVERY_ID],
          excludedMemberIds: [AVERY_ID],
        },
        steps: [{ logicalItemId: crypto.randomUUID(), text: "Unowned step", obligation: "required" }],
      },
    });
    expect(unassigned.ok(), await unassigned.text()).toBeTruthy();

    await enrollWall(request, page, `Overflow ${stamp}`);
    await waitForReadyPanes(page, PEOPLE.map((person) => person.id));
    await completeOtherOccurrences(page, AVERY_ID, [
      `Morning ${stamp}`,
      `Homework time ${stamp}`,
      `House cleaning ${stamp}`,
      `Dinner cleanup ${stamp}`,
      `Bedtime ${stamp}`,
      `Pet work ${stamp}`,
    ]);
    await page.reload();
    await waitForReadyPanes(page, PEOPLE.map((person) => person.id));
    await page.getByTestId(`family-pane-${quinnId}`).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(`family-pane-${quinnId}`)).toBeVisible();
    await page.getByTestId(`family-pane-${rileyId}`).scrollIntoViewIfNeeded();
    await expect(page.getByTestId(`family-empty-${rileyId}`)).toContainText("No assigned work today");

    await page.getByTestId(`family-pane-${AVERY_ID}`).scrollIntoViewIfNeeded();
    await clickFamilyControl(page, `family-upcoming-${AVERY_ID}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "upcoming");
    const upcomingList = page.getByTestId(`family-upcoming-list-${AVERY_ID}`);
    await expect(upcomingList).toContainText(`Homework time ${stamp}`);
    const homework = (await fetchPersonDay(page, AVERY_ID)).occurrences.find((row) =>
      row.title === `Homework time ${stamp}`,
    );
    expect(homework).toBeTruthy();
    await clickFamilyControl(page, `family-heading-${homework!.id}`);
    const averyPane = page.getByTestId(`family-pane-${AVERY_ID}`);
    await expect(averyPane.getByTestId(`family-work-${homework!.id}`)).toBeVisible();
    await expect(averyPane.locator(`[data-testid^="family-work-"]`)).toHaveCount(1);
    await clickFamilyControl(page, `family-back-next-${AVERY_ID}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "next");
    await clickFamilyControl(page, `family-more-${AVERY_ID}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "more");
    await clickFamilyControl(page, `family-earlier-${AVERY_ID}`);
    await clickFamilyControl(page, `family-back-next-${AVERY_ID}`);

    const jordanPane = page.getByTestId(`family-pane-${JORDAN_ID}`);
    const asNeededOcc = (await fetchPersonDay(page, JORDAN_ID)).occurrences.find((row) =>
      row.title === `As needed ${stamp}`,
    );
    expect(asNeededOcc).toBeTruthy();
    const notNeeded = jordanPane.getByRole("button", { name: `Mark ${asNeededText} not needed` });
    if (!(await notNeeded.isVisible().catch(() => false))) {
      await clickFamilyControl(jordanPane, `family-upcoming-${JORDAN_ID}`);
      const heading = jordanPane.getByTestId(`family-heading-${asNeededOcc!.id}`);
      if (await heading.isVisible().catch(() => false)) {
        await heading.click();
      } else {
        await clickFamilyControl(jordanPane, `family-more-${JORDAN_ID}`);
        await clickFamilyControl(jordanPane, `family-heading-${asNeededOcc!.id}`);
      }
    }
    await expect(notNeeded).toBeVisible();
    await notNeeded.click();
    await expect(notNeeded).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });

    await completeOtherOccurrences(page, AVERY_ID, []);
    await page.reload();
    await expect(page.getByTestId("display-needs-assignment")).toBeVisible();
    await page.getByRole("button", { name: new RegExp(unassignedTitle) }).click();
    const detail = page.getByTestId("display-detail");
    await expect(detail).toBeVisible();
    await expect(
      detail.getByText(/Needs assignment before this work can be completed|Assign this work in the household app/),
    ).toBeVisible();
    await expect(detail.locator("[data-testid^='display-step-done-']")).toHaveCount(0);
    await expect(detail.getByRole("button", { name: /claim/i })).toHaveCount(0);
  });

  test("AT15b/AT15c: pointer and keyboard focus defer enlarged idle return", async ({ page, request }) => {
    await page.addInitScript(() => { window.__HD_DISPLAY_IDLE_MS = 1200; });
    await ensureCrowdedWork(request);
    await enrollWall(request, page, `Idle guards ${Date.now().toString(36)}`);
    await waitForReadyPanes(page, PEOPLE.map((person) => person.id));
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 1000; });
    await clickFamilyControl(page, `family-upcoming-${AVERY_ID}`);
    await clickFamilyControl(page, `family-enlarge-${AVERY_ID}`);
    const pane = page.getByTestId(`family-pane-${AVERY_ID}`);
    const surface = pane.getByTestId(`family-scroll-${AVERY_ID}`);
    const box = await surface.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + Math.min(30, box!.height / 2));
    await page.mouse.down();
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 2400; });
    await page.waitForTimeout(400);
    await expect(pane).toHaveClass(/enlarged/);
    await page.mouse.up();
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 4000; });
    await expect(pane).not.toHaveClass(/enlarged/, { timeout: 5000 });
    await expect(page.getByTestId(`family-enlarge-${AVERY_ID}`)).toBeFocused();
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 5000; });
    await clickFamilyControl(page, `family-enlarge-${AVERY_ID}`);
    const back = page.getByTestId(`family-back-${AVERY_ID}`);
    await back.focus();
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 6500; });
    await page.waitForTimeout(400);
    await expect(pane).toHaveClass(/enlarged/);
    await expect(back).toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await expect(pane).not.toHaveClass(/enlarged/, { timeout: 5000 });
    await expect(page.getByTestId(`family-enlarge-${AVERY_ID}`)).toBeFocused();
  });

  test("AT15b: real touch cancellation releases the enlarged idle guard", async ({ page, request }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("chromium"), "Real touch cancellation uses Chromium CDP");
    await page.addInitScript(() => { window.__HD_DISPLAY_IDLE_MS = 1200; });
    await ensureCrowdedWork(request);
    await enrollWall(request, page, `Touch cancel ${Date.now().toString(36)}`);
    await waitForReadyPanes(page, PEOPLE.map((person) => person.id));
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 7000; });
    await clickFamilyControl(page, `family-enlarge-${AVERY_ID}`);
    const pane = page.getByTestId(`family-pane-${AVERY_ID}`);
    const surface = pane.getByTestId(`family-scroll-${AVERY_ID}`);
    const touchBox = await surface.boundingBox();
    expect(touchBox).toBeTruthy();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchBox!.x + touchBox!.width / 2, y: touchBox!.y + 20 }] });
    await page.evaluate(() => { window.__HD_DISPLAY_NOW_MS = 8500; });
    await page.waitForTimeout(400);
    await expect(pane).toHaveClass(/enlarged/);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await page.evaluate(() => { (document.activeElement as HTMLElement).blur(); window.__HD_DISPLAY_NOW_MS = 10_000; });
    await expect(pane).not.toHaveClass(/enlarged/, { timeout: 5000 });
    await cdp.detach();
  });

  test("AT4b/AT15c: wheel-browsed pane position survives enlargement and return", async ({ page, request }) => {
    await ensureCrowdedWork(request);
    for (let index = 0; index < 5; index += 1) {
      await createAssignedRoutine(request, { title: `Jordan scroll ${index} ${Date.now()}`, memberId: JORDAN_ID, daypart: "evening", steps: [{ text: `Jordan scroll step ${index}` }] });
    }
    await enrollWall(request, page, `Scroll return ${Date.now().toString(36)}`);
    await waitForReadyPanes(page, PEOPLE.map((person) => person.id));
    await clickFamilyControl(page, `family-more-${AVERY_ID}`);
    await clickFamilyControl(page, `family-upcoming-${JORDAN_ID}`);
    const siblingSurface = page.getByTestId(`family-scroll-${JORDAN_ID}`);
    await siblingSurface.hover();
    await page.mouse.wheel(0, 160);
    await expect.poll(() => siblingSurface.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const siblingPosition = await siblingSurface.evaluate((node) => node.scrollTop);
    const pane = page.getByTestId(`family-pane-${AVERY_ID}`);
    const surface = pane.getByTestId(`family-scroll-${AVERY_ID}`);
    await surface.hover();
    await page.mouse.wheel(0, 240);
    await expect.poll(() => surface.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const before = await surface.evaluate((node) => node.scrollTop);
    await page.getByTestId("display-org-by-work").click();
    await page.getByTestId("display-org-by-person").click();
    await expect.poll(() => surface.evaluate((node) => node.scrollTop)).toBe(before);
    await clickFamilyControl(page, `family-enlarge-${AVERY_ID}`);
    await expect(pane).toHaveClass(/enlarged/);
    await clickFamilyControl(page, `family-back-${AVERY_ID}`);
    await expect(page.getByTestId(`family-enlarge-${AVERY_ID}`)).toBeFocused();
    await expect.poll(() => surface.evaluate((node) => node.scrollTop)).toBe(before);
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-section", "upcoming");
    await expect.poll(() => siblingSurface.evaluate((node) => node.scrollTop)).toBe(siblingPosition);
  });

  test("AT13b/AT15a/AT15b/AT16b: personal detail is deliberate; idle is pane-local; reduced motion", async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.__HD_DISPLAY_IDLE_MS = 1200;
    });
    await ensureCrowdedWork(request);
    const unpromotedTitle = `Deliberate personal ${Date.now().toString(36)}`;
    const personalTask = await request.post("/api/v1/personal-tasks", {
      headers: await csrfHeaders(request),
      data: { title: unpromotedTitle, visibility: "household", showOnSharedDashboard: false },
    });
    expect(personalTask.ok(), await personalTask.text()).toBeTruthy();
    await enrollWall(request, page, `Idle ${Date.now().toString(36)}`);
    await waitForReadyPanes(page, PEOPLE.map((person) => person.id));
    const reduced = await page.evaluate(() =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(reduced).toBe(true);

    for (const person of PEOPLE) {
      const current = page.getByTestId(`family-current-${person.id}`);
      await assertNonOverlappingHits(current);
    }

    await page.evaluate(() => {
      window.__HD_DISPLAY_NOW_MS = 1_000;
    });
    await clickFamilyControl(page, `family-upcoming-${AVERY_ID}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "upcoming");
    await page.evaluate(() => {
      window.__HD_DISPLAY_NOW_MS = 2_000;
    });
    await clickFamilyControl(page, `family-upcoming-${JORDAN_ID}`);
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-section", "upcoming");
    await page.evaluate(() => {
      window.__HD_DISPLAY_NOW_MS = 2_300;
    });
    await page.waitForTimeout(400);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "next");
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute(
      "data-section",
      "upcoming",
    );

    await page.route("**/api/v1/display/occurrences/**/status", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });
    const done = page
      .getByTestId(`family-pane-${JORDAN_ID}`)
      .locator("[data-testid^='display-step-done-']")
      .first();
    await done.click();
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toBeVisible();
    await page.evaluate(() => {
      window.__HD_DISPLAY_NOW_MS = 4_000;
    });
    await page.waitForTimeout(400);
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute(
      "data-section",
      "upcoming",
    );

    const managerId = PEOPLE[0].id;
    const peopleGets: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes(`/api/v1/display/people/${managerId}`) && !req.url().includes("/day")) {
        peopleGets.push(req.url());
      }
    });
    await clickFamilyControl(page, `family-enlarge-${managerId}`);
    await expect(page.getByTestId(`family-back-${managerId}`)).toBeVisible();
    expect(peopleGets).toEqual([]);
    await expect(page.getByText(unpromotedTitle)).toHaveCount(0);
    await clickFamilyControl(page, `family-back-${managerId}`);
    await clickFamilyControl(page, `family-personal-${managerId}`);
    await expect(page.getByTestId("display-detail")).toBeVisible();
    await expect(page.getByTestId("display-detail")).toContainText(unpromotedTitle);
    await expect(page.getByTestId("display-detail").getByRole("button", { name: unpromotedTitle })).toHaveCount(0);
    expect(peopleGets.length).toBeGreaterThan(0);
  });
});
