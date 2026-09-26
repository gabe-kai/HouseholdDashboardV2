import { test, expect, type Page, type Browser, type APIRequestContext } from "@playwright/test";
import {
  addScheduledWorkAddition,
  chooseAssignmentMode,
  confirmResponsibilitySaveIfNeeded,
  ensureManagerSession,
  expectSignedInAs,
  fillResponsibilityBaseSteps,
  openResponsibilitySection,
  pickAccountablePerson,
  revealChecklist,
  sessionDisplayName,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const CASEY_ID = "22222222-2222-4222-8222-222222222204";
const AVERY_LOGIN = "e2e.avery";

function requestOrigin(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
}

async function csrf(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { csrfToken: string }).csrfToken;
}

async function mutatingHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  return {
    "x-csrf-token": await csrf(request),
    Origin: requestOrigin(),
  };
}

async function ensureManagerRequest(request: APIRequestContext) {
  const origin = requestOrigin();
  const boot = await request.post("/api/v1/test/bootstrap-claim");
  if (boot.ok()) {
    const { token } = (await boot.json()) as { token: string };
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: origin },
      data: {
        claimToken: token,
        loginName: "e2e.manager",
        passphrase: PASSPHRASE,
        displayName: "Morgan Reed",
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: "e2e.manager", passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function claimPerson(
  request: APIRequestContext,
  membershipId: string,
  loginName: string,
  displayName: string,
) {
  await ensureManagerRequest(request);
  const enroll = await request.post("/api/v1/enrollment/claims", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      membershipId,
      preset: "direct_personalizer",
    },
  });
  if (enroll.ok()) {
    const token = ((await enroll.json()) as { claim: { token: string } }).claim.token;
    await request.post("/api/v1/auth/logout", { headers: await mutatingHeaders(request) });
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: requestOrigin() },
      data: {
        claimToken: token,
        loginName,
        passphrase: PASSPHRASE,
        displayName,
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  await request.post("/api/v1/auth/logout", { headers: await mutatingHeaders(request) });
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: requestOrigin() },
    data: { loginName, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function claimAvery(request: APIRequestContext) {
  await claimPerson(request, AVERY_ID, AVERY_LOGIN, "Avery Reed");
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page);
  await page.goto("/");
  const name = await sessionDisplayName(page);
  await expectSignedInAs(page, name || /Morgan/);
}

async function createComposedKitchen(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: /Add responsibility/i }).click();
  await openResponsibilitySection(page, "Name");
  await page.getByRole("textbox", { name: "Name" }).fill(title);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await openResponsibilitySection(page, "When");
  await page.getByRole("button", { name: "Every day" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await openResponsibilitySection(page, "Who");
  await chooseAssignmentMode(page, "Fixed person");
  await page.getByRole("button", { name: /Choose accountable person/i }).click();
  await pickAccountablePerson(page, "Avery");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await fillResponsibilityBaseSteps(page, ["Counters", "Dishes", "Sweep"]);
  await addScheduledWorkAddition(page, {
    name: "Deep Clean",
    weekdays: [6],
    inheritAssignment: true,
    stepTexts: ["Oven", "Fridge", "Microwave", "Cabinets", "Floor"],
  });
  await page.getByRole("button", { name: "Create responsibility", exact: true }).click();
  await confirmResponsibilitySaveIfNeeded(page);
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
  return page.url().split("/").pop()!;
}

async function triggerVisibilityRefresh(page: Page) {
  await Promise.all([
    page.waitForResponse(
      (response) =>
        (response.url().includes("/api/v1/today") ||
          response.url().includes("/api/v1/responsibilities")) &&
        response.request().method() === "GET" &&
        response.ok(),
      { timeout: 15_000 },
    ),
    page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }),
  ]);
}

test.describe("P0-007B AT11/AT12 offline and live", () => {
  test("AT11: offline composed first action rejected after owner change", async ({
    browser,
  }: {
    browser: Browser;
  }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(testInfo.project.name !== "chromium", "Chromium-only multi-context AT11");

    const managerContext = await browser.newContext();
    const averyContext = await browser.newContext();
    const manager = await managerContext.newPage();
    const avery = await averyContext.newPage();
    await manager.setViewportSize({ width: 390, height: 844 });
    await avery.setViewportSize({ width: 390, height: 844 });

    const suffix = Date.now().toString(36);
    const title = `Offline Kitchen ${suffix}`;

    await openAsManager(manager);
    const kitchenId = await createComposedKitchen(manager, title);

    const session = await manager.request.get("/api/v1/auth/session");
    const today = ((await session.json()) as { householdDate: string }).householdDate;
    // Use today (Avery owns fixed) so composed offline intent needs no date-routing.
    const targetDate = today;
    await manager.request.get(`/api/v1/today?date=${targetDate}`);

    await claimAvery(avery.request);
    await avery.goto("/");
    const averyName = await sessionDisplayName(avery);
    await expectSignedInAs(avery, averyName || /Avery/);
    const card = avery.locator(".occurrence").filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await revealChecklist(card);

    await avery.route("**/api/v1/occurrences/**", (route) => route.abort());
    await card.getByRole("button", { name: /Mark .+ completed/i }).first().click();
    await expect(avery.locator(".status-pill[data-kind='pending']")).toBeVisible();

    await avery.reload();
    await expectSignedInAs(avery, averyName || /Avery/);
    await expect(avery.locator(".status-pill[data-kind='pending']")).toBeVisible();

    const detail = await manager.request.get(`/api/v1/responsibilities/${kitchenId}`);
    expect(detail.ok()).toBeTruthy();
    const body = (await detail.json()) as {
      responsibility: {
        version: number;
        revisions: Array<{
          daypart: string;
          weekdays: number[];
          steps: Array<{ text: string; obligation: string; logicalItemId?: string }>;
          scheduledAdditions?: unknown[];
        }>;
      };
    };
    const rev = body.responsibility.revisions.at(-1)!;
    const reassign = await manager.request.post(`/api/v1/responsibilities/${kitchenId}/revisions`, {
      headers: await mutatingHeaders(manager.request),
      data: {
        mutationId: crypto.randomUUID(),
        title,
        daypart: rev.daypart,
        weekdays: rev.weekdays,
        assignment: {
          mode: "take_turns",
          anchorDate: today,
          cycleOrder: [AVERY_ID, CASEY_ID],
          excludedMemberIds: [AVERY_ID, CASEY_ID],
        },
        scheduledAdditions: rev.scheduledAdditions ?? [],
        steps: rev.steps.map((step) => ({
          text: step.text,
          obligation: step.obligation,
          ...(step.logicalItemId ? { logicalItemId: step.logicalItemId } : {}),
        })),
        expectedVersion: body.responsibility.version,
        mode: "current",
      },
    });
    expect(reassign.ok(), await reassign.text()).toBeTruthy();

    await avery.unroute("**/api/v1/occurrences/**");
    await avery.reload();
    await expectSignedInAs(avery, averyName || /Avery/);
    await expect
      .poll(async () => {
        const errorPill = await avery.locator(".status-pill[data-kind='error']").count();
        const pending = await avery.locator(".status-pill[data-kind='pending']").count();
        const alert = await avery.getByRole("alert").count();
        const cardGone =
          (await avery.locator(".occurrence").filter({ hasText: title }).count()) === 0;
        if (errorPill > 0 || alert > 0) return "rejected";
        if (cardGone && pending === 0) return "cleared";
        if (pending === 0) return "cleared";
        return "pending";
      })
      .not.toBe("pending");

    const afterToday = await manager.request.get(`/api/v1/today?date=${targetDate}`);
    expect(afterToday.ok()).toBeTruthy();
    const afterOcc = (
      (await afterToday.json()) as {
        occurrences: Array<{
          definitionId: string;
          accountableMemberId: string | null;
          steps: Array<{ status: string }>;
          startedAt: string | null;
        }>;
      }
    ).occurrences.find((o) => o.definitionId === kitchenId);
    expect(afterOcc?.accountableMemberId ?? null).toBeNull();
    expect(afterOcc?.startedAt).toBeNull();
    expect(afterOcc?.steps.every((step) => step.status === "open")).toBeTruthy();

    const averyRapidContext = await browser.newContext();
    const averyRapid = await averyRapidContext.newPage();
    await claimAvery(averyRapid.request);
    const rapid = await manager.request.post("/api/v1/responsibilities", {
      headers: await mutatingHeaders(manager.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: `Rapid ${suffix}`,
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: today,
          fixedMemberId: AVERY_ID,
        },
        steps: [
          { text: "Alpha", obligation: "required" },
          { text: "Bravo", obligation: "required" },
        ],
      },
    });
    expect(rapid.ok(), await rapid.text()).toBeTruthy();
    const rapidId = ((await rapid.json()) as { responsibility: { id: string } }).responsibility.id;
    const rapidToday = await averyRapid.request.get(`/api/v1/today?date=${today}`);
    expect(rapidToday.ok()).toBeTruthy();
    const rapidOcc = (
      (await rapidToday.json()) as {
        occurrences: Array<{
          id: string;
          definitionId: string;
          revisionId: string;
          steps: Array<{ id: string; logicalItemId?: string }>;
        }>;
      }
    ).occurrences.find((o) => o.definitionId === rapidId);
    expect(rapidOcc, "rapid responsibility must materialize for Avery today").toBeTruthy();

    await averyRapid.goto("/?mutationDelayMs=1500");
    await expectSignedInAs(averyRapid, (await sessionDisplayName(averyRapid)) || /Avery/);
    const rapidCard = averyRapid.locator(".occurrence").filter({ hasText: `Rapid ${suffix}` });
    await expect(rapidCard).toBeVisible({ timeout: 20_000 });
    await revealChecklist(rapidCard);
    const buttons = rapidCard.getByRole("button", { name: /Mark .+ completed/ });
    await expect(buttons).toHaveCount(2);
    await buttons.nth(0).click();
    await buttons.nth(1).click();
    await expect(averyRapid.locator(".status-pill[data-kind='pending']")).toBeVisible();
    await expect(averyRapid.locator(".status-pill[data-kind='pending']")).toHaveCount(0, {
      timeout: 20_000,
    });

    const mismatch = await averyRapid.request.post(
      `/api/v1/occurrences/${rapidOcc!.id}/steps/${rapidOcc!.steps[0]!.id}/status`,
      {
        headers: await mutatingHeaders(averyRapid.request),
        data: {
          mutationId: crypto.randomUUID(),
          status: "completed",
          performedAt: new Date().toISOString(),
          activityGeneration: 0,
          kind: "responsibility",
          intendedStructure: {
            revisionId: crypto.randomUUID(),
            accountableMemberId: AVERY_ID,
            stepLogicalIds: rapidOcc!.steps.map((s) => s.logicalItemId ?? crypto.randomUUID()),
          },
        },
      },
    );
    expect(mismatch.ok()).toBeFalsy();

    await managerContext.close();
    await averyContext.close();
    await averyRapidContext.close();
  });

  test("AT12: dual-manager WS converge, suppress, stale GET, dirty draft", async ({
    browser,
  }: {
    browser: Browser;
  }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(testInfo.project.name !== "chromium", "Chromium-only multi-context AT12");

    const managerAContext = await browser.newContext();
    const managerBContext = await browser.newContext();
    const pageA = await managerAContext.newPage();
    const pageB = await managerBContext.newPage();
    await pageA.setViewportSize({ width: 390, height: 844 });
    await pageB.setViewportSize({ width: 390, height: 844 });

    const suffix = Date.now().toString(36);
    const title = `Live Kitchen ${suffix}`;

    await openAsManager(pageA);
    await openAsManager(pageB);
    const kitchenId = await createComposedKitchen(pageA, title);

    const averyOwnerContext = await browser.newContext();
    const caseyOwnerContext = await browser.newContext();
    const averyOwner = await averyOwnerContext.newPage();
    const caseyOwner = await caseyOwnerContext.newPage();
    await averyOwner.setViewportSize({ width: 390, height: 844 });
    await caseyOwner.setViewportSize({ width: 390, height: 844 });
    await claimAvery(averyOwner.request);
    await claimPerson(caseyOwner.request, CASEY_ID, "e2e.casey", "Casey Reed");
    await averyOwner.goto("/");
    const averyOwnerName = await sessionDisplayName(averyOwner);
    await expectSignedInAs(averyOwner, averyOwnerName || /Avery/);
    await expect(averyOwner.locator(".occurrence").filter({ hasText: title })).toBeVisible({
      timeout: 20_000,
    });

    await pageB.goto(`/plan/responsibilities/${kitchenId}`);
    await expect(pageB.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    await expect(pageB.locator(".responsibility-preview-list li").first()).toBeVisible();

    // Manager A saves a pattern change; Manager B + owners converge without reload.
    await pageA.getByRole("button", { name: "Edit", exact: true }).click();
    await openResponsibilitySection(pageA, "Who");
    await chooseAssignmentMode(pageA, "Fixed person");
    await pageA.getByRole("button", { name: /Choose accountable person|Avery|Casey|Jordan/i }).click();
    await pickAccountablePerson(pageA, "Casey");
    await pageA.getByRole("button", { name: "Done", exact: true }).click();
    await Promise.all([
      pageB.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/responsibilities/${kitchenId}`) &&
          response.request().method() === "GET" &&
          response.ok(),
        { timeout: 20_000 },
      ),
      (async () => {
        await pageA.getByRole("button", { name: "Save", exact: true }).click();
        await confirmResponsibilitySaveIfNeeded(pageA);
      })(),
    ]);
    await expect(pageB.getByText(/Casey/i).first()).toBeVisible({ timeout: 20_000 });
    await caseyOwner.goto("/");
    const caseyOwnerName = await sessionDisplayName(caseyOwner);
    await expectSignedInAs(caseyOwner, caseyOwnerName || /Casey/);
    await expect(caseyOwner.locator(".occurrence").filter({ hasText: title })).toBeVisible({
      timeout: 20_000,
    });
    await expect(averyOwner.locator(".occurrence").filter({ hasText: title })).toHaveCount(0, {
      timeout: 20_000,
    });

    // Suppress WS; prove stale; restore + visibility refresh.
    const muted = await pageB.evaluate(() => {
      const api = (
        window as unknown as {
          __hdSync?: { ignoreMessagesForTest: (ignore: boolean) => void };
        }
      ).__hdSync;
      if (!api?.ignoreMessagesForTest) return false;
      api.ignoreMessagesForTest(true);
      return true;
    });
    expect(muted).toBe(true);

    await pageA.getByRole("button", { name: "Edit", exact: true }).click();
    await openResponsibilitySection(pageA, "Who");
    await chooseAssignmentMode(pageA, "Fixed person");
    await pageA.getByRole("button", { name: /Choose accountable person|Casey|Avery|Jordan/i }).click();
    await pickAccountablePerson(pageA, "Avery");
    await pageA.getByRole("button", { name: "Done", exact: true }).click();
    await pageA.getByRole("button", { name: "Save", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(pageA);
    await expect(pageA.getByText(/Avery/i).first()).toBeVisible({ timeout: 20_000 });

    // While muted, B should still show Casey (stale).
    await expect(pageB.getByText(/Casey/i).first()).toBeVisible();

    await pageB.evaluate(() => {
      (
        window as unknown as {
          __hdSync?: { ignoreMessagesForTest: (ignore: boolean) => void };
        }
      ).__hdSync?.ignoreMessagesForTest(false);
    });
    await triggerVisibilityRefresh(pageB);
    await expect(pageB.getByText(/Avery/i).first()).toBeVisible({ timeout: 20_000 });

    // Hold an older preview GET; a newer fetch must win (generation arbitration).
    const stalePreview = await pageB.request.get(`/api/v1/responsibilities/${kitchenId}/preview`);
    expect(stalePreview.ok()).toBeTruthy();
    const staleBody = await stalePreview.text();
    expect(staleBody).not.toMatch(/Jordan/i);

    await pageA.getByRole("button", { name: "Edit", exact: true }).click();
    await openResponsibilitySection(pageA, "Who");
    await chooseAssignmentMode(pageA, "Fixed person");
    await pageA.getByRole("button", { name: /Choose accountable person|Avery|Jordan/i }).click();
    await pickAccountablePerson(pageA, "Jordan");
    await pageA.getByRole("button", { name: "Done", exact: true }).click();
    await pageA.getByRole("button", { name: "Save", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(pageA);
    await expect(pageA.getByText(/Jordan/i).first()).toBeVisible({ timeout: 20_000 });

    let releaseStale!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    let previewGets = 0;
    await pageB.route(`**/api/v1/responsibilities/${kitchenId}/preview`, async (route) => {
      previewGets += 1;
      if (previewGets === 1) {
        await staleGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: staleBody,
        });
        return;
      }
      await route.continue();
    });

    await pageB.reload();
    await expect(pageB.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => previewGets).toBeGreaterThanOrEqual(1);

    // Start a second preview while the first is still held so generation arbitration can run.
    await pageB.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    try {
      await expect.poll(() => previewGets, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    } catch {
      // Fallback: remount detail to force another preview fetch.
      await pageB.goto("/plan");
      await pageB.goto(`/plan/responsibilities/${kitchenId}`);
      await expect(pageB.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => previewGets).toBeGreaterThanOrEqual(2);
    }

    releaseStale();
    await expect
      .poll(async () => pageB.locator(".responsibility-preview-list").innerText(), {
        timeout: 20_000,
      })
      .toMatch(/Jordan/i);

    await pageB.unroute(`**/api/v1/responsibilities/${kitchenId}/preview`);

    // Dirty draft: open Edit, change Who; competing save from A → conflict with draft retained.
    await pageB.getByRole("button", { name: "Edit", exact: true }).click();
    await openResponsibilitySection(pageB, "Who");
    await chooseAssignmentMode(pageB, "Fixed person");
    await pageB.getByRole("button", { name: /Choose accountable person|Jordan|Casey/i }).click();
    await pickAccountablePerson(pageB, "Casey");
    await pageB.getByRole("button", { name: "Done", exact: true }).click();
    await expect(pageB.getByRole("button", { name: /^Who/ })).toContainText(/Casey/i);

    await pageA.getByRole("button", { name: "Edit", exact: true }).click();
    await openResponsibilitySection(pageA, "Who");
    await chooseAssignmentMode(pageA, "Fixed person");
    await pageA.getByRole("button", { name: /Choose accountable person|Jordan|Avery/i }).click();
    await pickAccountablePerson(pageA, "Avery");
    await pageA.getByRole("button", { name: "Done", exact: true }).click();
    await pageA.getByRole("button", { name: "Save", exact: true }).click();
    await confirmResponsibilitySaveIfNeeded(pageA);

    await pageB.getByRole("button", { name: "Save", exact: true }).click();
    const confirmDirty = pageB.getByRole("button", { name: "Confirm and save", exact: true });
    try {
      await confirmDirty.waitFor({ state: "visible", timeout: 5_000 });
      await confirmDirty.click();
    } catch {
      /* may save without confirm */
    }
    await expect(pageB.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByRole("button", { name: /^Who/ })).toContainText(/Casey/i);

    await managerAContext.close();
    await managerBContext.close();
    await averyOwnerContext.close();
    await caseyOwnerContext.close();
  });
});
