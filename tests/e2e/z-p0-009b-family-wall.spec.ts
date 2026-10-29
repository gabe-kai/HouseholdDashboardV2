import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { touchDragByCdp } from "../helpers/touch-drag";
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
    ["Homework time", "after_school"],
    ["House cleaning", "after_school"],
    ["Dinner cleanup", "evening"],
    ["Bedtime", "evening"],
    ["Pet work", "anytime"],
  ] as const) {
    await createAssignedRoutine(request, {
      title,
      memberId: AVERY_ID,
      daypart,
      steps: [{ text: `${title} step` }],
    });
  }
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
  if (!morning?.intendedStructure) return;
  await completeOtherOccurrences(page, AVERY_ID, morning.title);
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
    if (getDressed?.status === "open") {
      await completeDisplayStep(page, morning!, getDressed.id);
    }
    await page.reload();
    await expect(page.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    const averyPane = page.getByTestId(`family-pane-${AVERY_ID}`);
    const averyDone = averyPane.getByRole("button", { name: `Mark Brush teeth ${stamp} done` });
    if (!(await averyDone.isVisible().catch(() => false))) {
      await clickFamilyControl(averyPane, `family-back-next-${AVERY_ID}`);
    }
    if (!(await averyDone.isVisible().catch(() => false))) {
      await clickFamilyControl(averyPane, `family-upcoming-${AVERY_ID}`);
    }
    if (!(await averyDone.isVisible().catch(() => false))) {
      await clickFamilyControl(averyPane, `family-more-${AVERY_ID}`);
    }
    await expect(averyDone).toBeVisible();
    const doneTestId = await averyDone.getAttribute("data-testid");
    expect(doneTestId).toBeTruthy();
    const jordanPane = page.getByTestId(`family-pane-${JORDAN_ID}`);
    await clickFamilyControl(jordanPane, `family-upcoming-${JORDAN_ID}`);
    await expect(jordanPane).toHaveAttribute("data-section", "upcoming");
    await clickFamilyControl(averyPane, doneTestId!);
    await expect(averyPane.locator(`[data-testid="${doneTestId}"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 15_000 },
    );
    await expect(jordanPane).toHaveAttribute("data-section", "upcoming");
    await page.getByTestId("display-org-by-work").click({ force: true });
    await expect(page.getByTestId("display-by-work")).toBeVisible();
    await page.getByTestId("display-org-by-person").click({ force: true });
    await expect(jordanPane).toHaveAttribute("data-section", "upcoming");
    const namesAfter = await page.locator(".family-board-pane .display-person-name").allTextContents();
    expect(namesAfter.slice(0, PEOPLE.length)).toEqual(PEOPLE.map((person) => person.name));
  });

  test("AT15c/AT16b: enlarge return and keyboard; touch does not complete", async ({
    page,
    request,
    browserName,
  }) => {
    await ensureCrowdedWork(request);
    await enrollWall(request, page, `Enlarge ${Date.now().toString(36)}`);
    const averyPane = page.getByTestId(`family-pane-${AVERY_ID}`);
    await clickFamilyControl(page, `family-enlarge-${AVERY_ID}`);
    await expect(averyPane).toHaveClass(/enlarged/);
    await clickFamilyControl(page, `family-back-${AVERY_ID}`);
    await expect(page.getByTestId(`family-enlarge-${AVERY_ID}`)).toBeFocused();
    await page.keyboard.press("Tab");
    const done = averyPane.locator("[data-testid^='display-step-done-']").first();
    const before = await done.getAttribute("aria-pressed");
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
    await expect(done).toHaveAttribute("aria-pressed", before ?? "false");
  });

  test("AT16a: six identities at native 3840 and 1920", async ({ page, request }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width < 1920, "native target viewport");
    const { stamp } = await ensureCrowdedWork(request);
    await enrollWall(request, page, `Geom ${stamp}`);
    await markAveryMorningProgress(page, stamp);
    await page.reload();
    await expect(page.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    for (const person of PEOPLE) {
      await expect(page.getByTestId(`family-pane-${person.id}`)).toBeVisible();
    }
    await expect(page.getByTestId(`family-next-${AVERY_ID}`)).toContainText("2/5 done");
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toContainText(
      "Pack the unusually long backpack checklist",
    );
    async function assertNoPageScrollAndPanesFit() {
      const metrics = await page.evaluate((ids: string[]) => {
        const doc = document.documentElement;
        const panes = ids.map((id) => {
          const box = document.querySelector(`[data-testid="family-pane-${id}"]`)?.getBoundingClientRect();
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
      expect(metrics.y).toBeLessThan(80);
      expect(metrics.x).toBeLessThan(80);
      for (const pane of metrics.panes) {
        expect(pane.height).toBeGreaterThan(80);
        expect(pane.top).toBeGreaterThanOrEqual(-1);
        expect(pane.bottom).toBeLessThanOrEqual(metrics.innerHeight + 1);
      }
    }
    await assertNoPageScrollAndPanesFit();
    fs.mkdirSync("reports/_local-screenshots/p0-009b-r2", { recursive: true });
    await page.screenshot({
      path: "reports/_local-screenshots/p0-009b-r2/3840x2160.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    for (const person of PEOPLE) {
      await expect(page.getByTestId(`family-pane-${person.id}`)).toBeVisible();
    }
    await assertNoPageScrollAndPanesFit();
    await page.screenshot({
      path: "reports/_local-screenshots/p0-009b-r2/1920x1080.png",
      fullPage: true,
    });
  });

  test("AT11a: one pane 5xx keeps sibling usable", async ({ page, request }) => {
    await ensureCrowdedWork(request);
    await enrollWall(request, page, `Fail ${Date.now().toString(36)}`);
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
    const board = page.getByTestId("display-by-person");
    await board.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(page.getByTestId(`family-pane-${quinnId}`)).toBeVisible();
    await expect(page.getByTestId(`family-empty-${rileyId}`)).toContainText("No assigned work today");

    await board.evaluate((node) => {
      node.scrollTop = 0;
    });
    await clickFamilyControl(page, `family-upcoming-${AVERY_ID}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "upcoming");
    await expect(page.getByTestId(`family-upcoming-list-${AVERY_ID}`)).toContainText(
      /Homework time|House cleaning|Dinner cleanup|Bedtime|Pet work/,
    );
    await clickFamilyControl(page, `family-back-next-${AVERY_ID}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "next");
    await clickFamilyControl(page, `family-more-${AVERY_ID}`);
    await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "more");
    await clickFamilyControl(page, `family-earlier-${AVERY_ID}`);
    await clickFamilyControl(page, `family-back-next-${AVERY_ID}`);

    const jordanPane = page.getByTestId(`family-pane-${JORDAN_ID}`);
    const notNeeded = jordanPane.getByRole("button", { name: `Mark ${asNeededText} not needed` });
    if (!(await notNeeded.isVisible().catch(() => false))) {
      await clickFamilyControl(jordanPane, `family-upcoming-${JORDAN_ID}`);
      await clickFamilyControl(jordanPane, `family-more-${JORDAN_ID}`);
    }
    await expect(notNeeded).toBeVisible();
    await notNeeded.evaluate((node) => (node as HTMLElement).click());
    await expect(notNeeded).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });

    await expect(page.getByTestId("display-needs-assignment")).toBeVisible();
    await page.getByRole("button", { name: new RegExp(unassignedTitle) }).click({ force: true });
    const detail = page.getByTestId("display-detail");
    await expect(detail).toBeVisible();
    await expect(
      detail.getByText(/Needs assignment before this work can be completed|Assign this work in the household app/),
    ).toBeVisible();
    await expect(detail.locator("[data-testid^='display-step-done-']")).toHaveCount(0);
    await expect(detail.getByRole("button", { name: /claim/i })).toHaveCount(0);
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
    await enrollWall(request, page, `Idle ${Date.now().toString(36)}`);
    const reduced = await page.evaluate(() =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(reduced).toBe(true);

    const hits = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll(".family-board-hit")]
        .map((node) => (node as HTMLElement).getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0);
      return {
        min: Math.min(...boxes.map((box) => Math.min(box.width, box.height))),
        count: boxes.length,
      };
    });
    expect(hits.count).toBeGreaterThan(0);
    expect(hits.min).toBeGreaterThanOrEqual(48);

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
    await done.evaluate((node) => (node as HTMLElement).click());
    await expect(page.getByTestId(`family-pending-${JORDAN_ID}`)).toBeVisible();
    await page.evaluate(() => {
      window.__HD_DISPLAY_NOW_MS = 4_000;
    });
    await page.waitForTimeout(400);
    await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute(
      "data-section",
      "upcoming",
    );

    const peopleGets: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes(`/api/v1/display/people/${AVERY_ID}`) && !req.url().includes("/day")) {
        peopleGets.push(req.url());
      }
    });
    await clickFamilyControl(page, `family-enlarge-${AVERY_ID}`);
    await expect(page.getByTestId(`family-back-${AVERY_ID}`)).toBeVisible();
    expect(peopleGets).toEqual([]);
    await clickFamilyControl(page, `family-back-${AVERY_ID}`);
    await clickFamilyControl(page, `family-personal-${AVERY_ID}`);
    await expect(page.getByTestId("display-detail")).toBeVisible();
    expect(peopleGets.length).toBeGreaterThan(0);
  });
});
