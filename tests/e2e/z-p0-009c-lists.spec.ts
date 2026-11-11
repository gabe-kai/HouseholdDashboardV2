import { expect, test } from "@playwright/test";
import { AVERY_ID, JORDAN_ID, createAssignedRoutine, enrollWall, ensureManagerSession, fetchPersonDay, clickFamilyControl, csrfHeaders, householdDate, completeDisplayStep } from "../helpers/p0-009b";
import { expectSignedInAs } from "../helpers/e2e-shell";

test("P0-009C AT1/AT2/AT7: named day lists and return preserve the sibling", async ({ page, request }) => {
  await ensureManagerSession(request);
  const stamp = Date.now().toString(36);
  const titles = [`Morning ${stamp}`, `School ${stamp}`, `Bedtime ${stamp}`];
  for (const [index, title] of titles.entries()) await createAssignedRoutine(request, { title, memberId: AVERY_ID, daypart: (["morning", "after_school", "evening"] as const)[index], steps: index === 1 ? [{ text: `Step ${title}` }, { text: `Optional ${title}`, obligation: "as_needed" }] : [{ text: `Step ${title}` }] });
  const chore = `Chore ${stamp}`;
  const created = await request.post("/api/v1/responsibilities", { headers: await csrfHeaders(request), data: {
    mutationId: crypto.randomUUID(), title: chore, daypart: "anytime", weekdays: [1, 2, 3, 4, 5, 6, 7],
    assignment: { mode: "take_turns", anchorDate: await householdDate(request), cycleOrder: [AVERY_ID, JORDAN_ID] },
    steps: [{ logicalItemId: crypto.randomUUID(), text: `Step ${chore}`, obligation: "required" }],
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  await enrollWall(request, page, `Lists ${stamp}`);
  await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready");
  await clickFamilyControl(page, `family-upcoming-${JORDAN_ID}`);
  const day = await fetchPersonDay(page, AVERY_ID);
  const occurrence = day.occurrences.find((row) => row.title === titles[0])!;
  expect(occurrence).toBeTruthy();
  await completeDisplayStep(page, occurrence, occurrence.steps[0].id);
  await page.getByTestId(`family-personal-${AVERY_ID}`).click();
  const detail = page.getByTestId("display-detail");
  await expect(detail.getByRole("heading", { name: "Avery Reed" })).toBeVisible();
  const response = await page.request.get(`/api/v1/display/people/${AVERY_ID}`);
  expect(response.ok()).toBeTruthy();
  const person = ((await response.json()) as { person: { membershipId: string; recurringWork: Array<{ occurrenceId: string; title: string; state: string; progressLabel: string; completed: boolean }> } }).person;
  expect(person.membershipId).toBe(AVERY_ID);
  for (const title of [...titles, chore]) {
    const matching = person.recurringWork.filter((row) => row.title === title);
    expect(matching).toHaveLength(1);
    const row = matching[0];
    const button = detail.locator(`[id="display-person-work-${row.occurrenceId}"]`);
    await expect(button).toHaveCount(1);
    await expect(button).toContainText(title);
    await expect(button).toContainText(`${row.state} · ${row.progressLabel}`);
  }
  expect(person.recurringWork.find((row) => row.title === titles[0])?.completed).toBe(true);
  await detail.getByRole("button", { name: new RegExp(titles[0]) }).click();
  await expect(detail.getByText(`Step ${titles[0]}`)).toBeVisible();
  const done = detail.getByRole("button", { name: `Mark Step ${titles[0]} done` });
  await expect(done).toHaveAttribute("aria-pressed", "true");
  await detail.getByRole("button", { name: `Mark Step ${titles[0]} open` }).click();
  await expect.poll(async () => (await fetchPersonDay(page, AVERY_ID)).occurrences.find((row) => row.id === occurrence.id)?.steps[0]?.status).toBe("open");
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(detail.getByRole("heading", { name: "Avery Reed" })).toBeVisible();
  const later = day.occurrences.find((row) => row.title === titles[1])!;
  expect(later).toBeTruthy();
  await detail.getByRole("button", { name: new RegExp(titles[1]) }).click();
  await expect(detail.locator(".display-step .display-work-title")).toHaveText([`Step ${titles[1]}`, `Optional ${titles[1]}`]);
  await detail.getByRole("button", { name: `Mark Optional ${titles[1]} not needed` }).click();
  await expect.poll(async () => (await fetchPersonDay(page, AVERY_ID)).occurrences.find((row) => row.id === later.id)?.steps[1]?.status).toBe("not_needed");
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-section", "upcoming");
  await expect(page.getByTestId(`family-personal-${AVERY_ID}`)).toBeFocused();
});

test("P0-009C AT5: preview navigates the same lists read-only", async ({ page, browser }) => {
  await ensureManagerSession(page.request);
  const title = `Preview lists ${Date.now().toString(36)}`;
  await createAssignedRoutine(page.request, { title, memberId: AVERY_ID, steps: [{ text: `Step ${title}` }] });
  const wallContext = await browser.newContext();
  const wall = await wallContext.newPage();
  const displayId = await enrollWall(page.request, wall, title);
  await page.goto("/household/displays");
  await expectSignedInAs(page, "Morgan Reed");
  const displayCalls: string[] = [];
  page.on("request", (req) => { if (new URL(req.url()).pathname.startsWith("/api/v1/display/")) displayCalls.push(req.url()); });
  await page.getByTestId(`display-preview-${displayId}`).click();
  const frame = page.frameLocator('[data-testid="display-preview-frame"]');
  await expect(frame.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready");
  await frame.getByTestId(`family-personal-${AVERY_ID}`).click();
  const detail = frame.getByTestId("display-detail");
  await expect(detail.getByText(title, { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: new RegExp(title) }).click();
  await expect(detail.getByText(`Step ${title}`)).toBeVisible();
  await expect(detail.locator("[data-testid^='display-step-done-']")).toHaveCount(0);
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(detail.getByText(title, { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(frame.getByTestId(`family-personal-${AVERY_ID}`)).toBeFocused();
  expect(displayCalls).toEqual([]);
  await wallContext.close();
});

test("P0-009C AT1: a pending-sign-in person with no work can open their lists", async ({ page, request }) => {
  await ensureManagerSession(request);
  const name = `Pending person ${Date.now().toString(36)}`;
  const created = await request.post("/api/v1/people", { headers: await csrfHeaders(request), data: {
    mutationId: crypto.randomUUID(), displayName: name, classification: "child",
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = ((await created.json()) as { person: { id: string } }).person.id;
  await enrollWall(request, page, name);
  const dashboard = await page.request.get("/api/v1/display/dashboard");
  const data = await dashboard.json() as { dashboard: { byPerson: Array<{ membershipId: string; status: string }> } };
  expect(data.dashboard.byPerson.find((person) => person.membershipId === id)?.status).toBe("pending");
  const pane = page.getByTestId(`family-pane-${id}`);
  await expect(pane).toHaveAttribute("data-phase", "ready");
  await expect(pane.getByTestId(`family-empty-${id}`)).toBeVisible();
  await pane.getByRole("button", { name: "All my lists" }).click();
  const detail = page.getByTestId("display-detail");
  await expect(detail.getByRole("heading", { name })).toBeVisible();
  await expect(detail.getByText("No assigned work today")).toBeVisible();
});

test("P0-009C AT1: list loading failure offers a working retry", async ({ page, request }) => {
  await ensureManagerSession(request);
  await enrollWall(request, page, `Retry lists ${Date.now().toString(36)}`);
  let failReads = true;
  await page.route(`**/api/v1/display/people/${AVERY_ID}`, async (route) => {
    if (failReads) await route.fulfill({ status: 500, body: "unavailable" });
    else await route.continue();
  });
  await page.getByTestId(`family-personal-${AVERY_ID}`).click();
  const detail = page.getByTestId("display-detail");
  await expect(detail.getByTestId("display-detail-unavailable")).toBeVisible();
  failReads = false;
  await detail.getByRole("button", { name: "Retry" }).click();
  await expect(detail.getByRole("heading", { name: "Avery Reed" })).toBeVisible();
});

test("P0-009C AT9: a held lists response cannot restore a revoked wall", async ({ page, request }) => {
  await ensureManagerSession(request);
  const displayId = await enrollWall(request, page, `Revoked lists ${Date.now().toString(36)}`);
  const snapshot = await (await page.request.get(`/api/v1/display/people/${AVERY_ID}`)).text();
  let release = () => undefined as void;
  let entered = () => undefined as void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const captured = new Promise<void>((resolve) => { entered = resolve; });
  let delivered = () => undefined as void;
  const done = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route(`**/api/v1/display/people/${AVERY_ID}`, async (route) => {
    entered(); await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: snapshot });
    delivered();
  });
  await page.getByTestId(`family-personal-${AVERY_ID}`).click();
  await captured;
  const displays = await request.get("/api/v1/displays");
  expect(displays.ok()).toBeTruthy();
  const row = ((await displays.json()) as { displays: Array<{ id: string; configVersion: number }> }).displays.find((item) => item.id === displayId)!;
  expect(row).toBeTruthy();
  const revoke = await request.post(`/api/v1/displays/${displayId}/revoke`, { headers: await csrfHeaders(request), data: { mutationId: crypto.randomUUID(), expectedConfigVersion: row.configVersion } });
  expect(revoke.ok(), await revoke.text()).toBeTruthy();
  expect((await page.request.get("/api/v1/display/session")).status()).toBe(401);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByTestId("display-setup").or(page.getByTestId("display-blank"))).toBeVisible({ timeout: 20_000 });
  release(); await done;
  await expect(page.getByTestId("display-detail")).toHaveCount(0);
  await expect(page.getByTestId("family-board")).toHaveCount(0);
});

test("P0-009C AT9: selected-display loss while preview lists are held clears content", async ({ page, browser }) => {
  await ensureManagerSession(page.request);
  const context = await browser.newContext();
  const wall = await context.newPage();
  const displayId = await enrollWall(page.request, wall, `Preview revoked ${Date.now().toString(36)}`);
  await page.goto("/household/displays");
  await expectSignedInAs(page, "Morgan Reed");
  await page.getByTestId(`display-preview-${displayId}`).click();
  const frame = page.frameLocator('[data-testid="display-preview-frame"]');
  await expect(frame.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready");
  let entered = () => undefined as void;
  let release = () => undefined as void;
  const captured = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/v1/displays/${displayId}/preview/people/${AVERY_ID}`, async (route) => { entered(); await held; await route.continue(); });
  await frame.getByTestId(`family-personal-${AVERY_ID}`).click();
  await captured;
  const list = await page.request.get("/api/v1/displays");
  const display = ((await list.json()) as { displays: Array<{ id: string; configVersion: number }> }).displays.find((row) => row.id === displayId)!;
  expect(display).toBeTruthy();
  const revoked = await page.request.post(`/api/v1/displays/${displayId}/revoke`, { headers: await csrfHeaders(page.request), data: { mutationId: crypto.randomUUID(), expectedConfigVersion: display.configVersion } });
  expect(revoked.ok(), await revoked.text()).toBeTruthy();
  release();
  await expect(frame.getByTestId("family-board")).toHaveCount(0, { timeout: 20_000 });
  await expect(frame.getByTestId("display-detail")).toHaveCount(0);
  await context.close();
});

test("P0-009C AT8: pending list action cannot replace the newly selected checklist", async ({ page, request }) => {
  await ensureManagerSession(request);
  const stamp = Date.now().toString(36);
  const first = `Pending list ${stamp}`;
  const second = `Other list ${stamp}`;
  for (const title of [first, second]) await createAssignedRoutine(request, { title, memberId: AVERY_ID, steps: [{ text: `Step ${title}` }] });
  await enrollWall(request, page, first);
  const day = await fetchPersonDay(page, AVERY_ID);
  const occurrence = day.occurrences.find((row) => row.title === first)!;
  expect(occurrence).toBeTruthy();
  let entered = () => undefined as void;
  let release = () => undefined as void;
  const captured = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/display/occurrences/**/status", async (route) => { entered(); await held; await route.continue(); });
  await page.getByTestId(`family-personal-${AVERY_ID}`).click();
  const detail = page.getByTestId("display-detail");
  await detail.getByRole("button", { name: new RegExp(first) }).click();
  await detail.getByRole("button", { name: `Mark Step ${first} done` }).click();
  await captured;
  await expect(detail.getByTestId(`display-step-${occurrence.steps[0].id}`).getByRole("status")).toContainText(/saving|pending|retry/i);
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByText("Saving checklist changes…")).toBeVisible();
  await detail.getByRole("button", { name: new RegExp(first) }).click();
  await expect(detail.getByTestId(`display-step-${occurrence.steps[0].id}`).getByRole("status")).toContainText(/saving|pending|retry/i);
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await detail.getByRole("button", { name: new RegExp(second) }).click();
  await expect(detail.getByRole("heading", { name: second })).toBeVisible();
  release();
  await expect.poll(async () => (await fetchPersonDay(page, AVERY_ID)).occurrences.find((row) => row.id === occurrence.id)?.steps[0]?.status).toBe("completed");
  await expect(page.getByText("Saving checklist changes…")).toHaveCount(0);
  await expect(detail.getByRole("heading", { name: second })).toBeVisible();
  await expect(detail.getByText(`Step ${second}`)).toBeVisible();
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await detail.getByRole("button", { name: new RegExp(first) }).click();
  await expect(detail.getByRole("button", { name: `Mark Step ${first} done` })).toHaveAttribute("aria-pressed", "true");
  await expect(detail.getByTestId(`display-step-${occurrence.steps[0].id}`).locator("[data-kind='pending']")).toHaveCount(0);
});

test("P0-009C AT8: remote change converges in the open checklist and preserves sibling", async ({ page, request, browser }) => {
  await ensureManagerSession(request);
  const title = `Remote list ${Date.now().toString(36)}`;
  await createAssignedRoutine(request, { title, memberId: AVERY_ID, steps: [{ text: `Step ${title}` }] });
  await enrollWall(request, page, title);
  await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-phase", "ready");
  await clickFamilyControl(page, `family-upcoming-${JORDAN_ID}`);
  const remoteContext = await browser.newContext();
  const remote = await remoteContext.newPage();
  await enrollWall(request, remote, `${title} remote`);
  const day = await fetchPersonDay(remote, AVERY_ID);
  const occurrence = day.occurrences.find((row) => row.title === title)!;
  expect(occurrence).toBeTruthy();
  await page.getByTestId(`family-personal-${AVERY_ID}`).click();
  const detail = page.getByTestId("display-detail");
  await detail.getByRole("button", { name: new RegExp(title) }).click();
  const done = detail.getByRole("button", { name: `Mark Step ${title} done` });
  await expect(done).toHaveAttribute("aria-pressed", "false");
  let navigations = 0;
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1; });
  await completeDisplayStep(remote, occurrence, occurrence.steps[0].id);
  await expect(done).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  await expect(detail.getByRole("heading", { name: title })).toBeVisible();
  expect(navigations).toBe(0);
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId(`family-pane-${JORDAN_ID}`)).toHaveAttribute("data-section", "upcoming");
  await remoteContext.close();
});

test("P0-009C AT4/AT6: enlargement exposes names without fetching personal detail", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("webkit"), "Chromium establishes native target geometry");
  await ensureManagerSession(request);
  const stamp = Date.now().toString(36);
  const title = `Expanded ${stamp}`;
  await createAssignedRoutine(request, { title, memberId: AVERY_ID, steps: [{ text: `Long checklist ${stamp}` }] });
  const personalRequests: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === `/api/v1/display/people/${AVERY_ID}`) personalRequests.push(req.url());
  });
  await enrollWall(request, page, title);
  await expect(page.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-phase", "ready");
  for (const width of [1920, 3840]) {
    await page.setViewportSize({ width, height: width * 9 / 16 });
    await page.getByTestId(`family-enlarge-${AVERY_ID}`).click();
    const lists = page.getByTestId(`family-expanded-lists-${AVERY_ID}`);
    await expect(lists.getByRole("button", { name: new RegExp(title) })).toBeVisible();
    const rect = await lists.boundingBox();
    expect(rect).toBeTruthy();
    expect(rect!.width).toBeGreaterThan(400);
    expect(personalRequests).toHaveLength(0);
    await page.screenshot({ path: `reports/_local-screenshots/p0-009c-expanded-${width}.png` });
    await lists.getByRole("button", { name: new RegExp(title) }).click();
    const checklist = page.getByTestId("display-detail").getByText(`Long checklist ${stamp}`);
    await expect(checklist).toBeVisible();
    const checklistBox = await checklist.boundingBox();
    expect(checklistBox).toBeTruthy();
    expect(checklistBox!.width).toBeGreaterThan(100);
    expect(checklistBox!.x).toBeGreaterThanOrEqual(0);
    expect(checklistBox!.x + checklistBox!.width).toBeLessThanOrEqual(width);
    expect(checklistBox!.y + checklistBox!.height).toBeLessThanOrEqual(width * 9 / 16);
    expect(parseFloat(await checklist.evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: `reports/_local-screenshots/p0-009c-checklist-${width}.png` });
    await page.getByTestId("display-detail").getByRole("button", { name: "Back", exact: true }).click();
    await expect(lists).toBeVisible();
    await page.getByTestId(`family-back-${AVERY_ID}`).click();
  }
});
