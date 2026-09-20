import { test, expect, type APIRequestContext, type Page, type Browser } from "@playwright/test";
import {
  expectSignedInAs,
  fillFocusedResponsibilityCreate,
} from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_LOGIN = "e2e.avery";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const JORDAN_ID = "22222222-2222-4222-8222-222222222203";

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

async function csrf(request: APIRequestContext): Promise<string> {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { csrfToken: string }).csrfToken;
}

async function mutatingHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  return {
    "x-csrf-token": await csrf(request),
    Origin: requestOrigin(request),
  };
}

async function claimMember(
  request: APIRequestContext,
  membershipId: string,
  loginName: string,
  displayName: string,
) {
  await ensureManagerSession(request);
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
      headers: { Origin: requestOrigin(request) },
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
    headers: { Origin: requestOrigin(request) },
    data: { loginName, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  const session = await page.request.get("/api/v1/auth/session");
  expect(session.ok(), await session.text()).toBeTruthy();
  const body = (await session.json()) as { member?: { displayName?: string } };
  const displayName = body.member?.displayName ?? "Morgan Reed";
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Plan", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press("Escape");
  await expectSignedInAs(page, displayName);
}

async function createResponsibilityViaUi(page: Page, title: string, stepTexts: string[]) {
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await fillFocusedResponsibilityCreate(page, {
    title,
    weekdaysPreset: "every",
    daypart: "anytime",
    ownerName: "Avery",
    stepTexts,
  });
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
  return page.url().split("/").pop()!;
}

async function openAveryChild(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await claimMember(page.request, AVERY_ID, AVERY_LOGIN, "Avery Reed");
  const session = await page.request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const displayName =
    ((await session.json()) as { member?: { displayName?: string } }).member?.displayName ??
    "Avery Reed";
  return { context, page, displayName };
}

test.describe("P0-007A re-acceptance AT7/AT12/AT15", () => {
  test("AT7: rapid delayed taps, pending vs reassign, out-of-order response", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(testInfo.project.name !== "chromium", "Phone Chromium AT7 matrix");
    await page.setViewportSize({ width: 390, height: 844 });

    await openAsManager(page);
    const rapidTitle = `AT7 Rapid ${Date.now().toString(36)}`;
    await createResponsibilityViaUi(page, rapidTitle, ["Alpha", "Bravo"]);

    const { context: childContext, page: child, displayName: averyName } =
      await openAveryChild(browser);
    await child.goto("/?mutationDelayMs=2000");
    await expectSignedInAs(child, averyName);
    const rapidCard = child.locator(".occurrence").filter({ hasText: rapidTitle });
    await expect(rapidCard).toBeVisible({ timeout: 20_000 });
    const doneButtons = rapidCard.getByRole("button", { name: /Mark .+ completed/ });
    await expect(doneButtons).toHaveCount(2);
    const t0 = Date.now();
    await doneButtons.nth(0).click();
    await doneButtons.nth(1).click();
    await expect(rapidCard.getByTestId(/step-status-/).nth(0)).toContainText(/Completed/i);
    await expect(rapidCard.getByTestId(/step-status-/).nth(1)).toContainText(/Completed/i);
    await expect(child.locator(".status-pill[data-kind='pending']")).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(2500);
    await expect(child.locator(".status-pill[data-kind='pending']")).toHaveCount(0, {
      timeout: 20_000,
    });

    const pendingTitle = `AT7 Pending ${Date.now().toString(36)}`;
    await page.goto("/");
    await expectSignedInAs(page, "Morgan Reed");
    const pendingId = await createResponsibilityViaUi(page, pendingTitle, ["Only step"]);

    await child.goto("/");
    await expectSignedInAs(child, averyName);
    const pendingCard = child.locator(".occurrence").filter({ hasText: pendingTitle });
    await expect(pendingCard).toBeVisible({ timeout: 20_000 });
    await child.route("**/api/v1/occurrences/**", (route) => route.abort());
    await pendingCard.getByRole("button", { name: /Mark Only step completed/i }).click();
    await expect(child.locator(".status-pill[data-kind='pending']")).toBeVisible();
    await child.reload();
    await expectSignedInAs(child, averyName);
    await expect(child.locator(".status-pill[data-kind='pending']")).toBeVisible();

    const pendingDetail = await page.request.get(`/api/v1/responsibilities/${pendingId}`);
    expect(pendingDetail.ok()).toBeTruthy();
    const pendingBody = (await pendingDetail.json()) as {
      responsibility: {
        version: number;
        revisions: Array<{
          daypart: string;
          weekdays: number[];
          steps: Array<{ text: string; obligation: string; logicalItemId?: string }>;
        }>;
      };
    };
    const rev = pendingBody.responsibility.revisions[0]!;
    await page.request.post("/api/v1/enrollment/claims", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        membershipId: JORDAN_ID,
        preset: "direct_personalizer",
      },
    });
    const reassign = await page.request.post(`/api/v1/responsibilities/${pendingId}/revisions`, {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: pendingTitle,
        daypart: rev.daypart,
        weekdays: rev.weekdays,
        accountableMemberId: JORDAN_ID,
        steps: rev.steps.map((step) => ({
          text: step.text,
          obligation: step.obligation,
          ...(step.logicalItemId ? { logicalItemId: step.logicalItemId } : {}),
        })),
        expectedVersion: pendingBody.responsibility.version,
        mode: "current",
      },
    });
    expect(reassign.ok(), await reassign.text()).toBeTruthy();

    await child.unroute("**/api/v1/occurrences/**");
    await child.reload();
    await expectSignedInAs(child, averyName);
    await expect(child.locator(".occurrence").filter({ hasText: pendingTitle })).toHaveCount(0, {
      timeout: 20_000,
    });

    const orderTitle = `AT7 Order ${Date.now().toString(36)}`;
    await page.goto("/");
    await expectSignedInAs(page, "Morgan Reed");
    await createResponsibilityViaUi(page, orderTitle, ["Order step"]);
    await child.goto("/");
    await expectSignedInAs(child, averyName);
    const orderCard = child.locator(".occurrence").filter({ hasText: orderTitle });
    await expect(orderCard).toBeVisible({ timeout: 20_000 });

    let releaseOlder!: () => void;
    const olderGate = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    let statusCalls = 0;
    await child.route("**/api/v1/occurrences/**/status", async (route) => {
      statusCalls += 1;
      if (statusCalls === 1) {
        const response = await route.fetch();
        await olderGate;
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });

    await orderCard.getByRole("button", { name: /Mark Order step completed/i }).click();
    await expect(orderCard.getByTestId(/step-status-/)).toContainText(/Completed/i);
    await orderCard.getByRole("button", { name: /Mark Order step open/i }).click();
    await expect(orderCard.getByTestId(/step-status-/)).toContainText(/Open|Not started|To do/i, {
      timeout: 15_000,
    });
    releaseOlder();
    await expect
      .poll(async () => orderCard.getByTestId(/step-status-/).textContent(), { timeout: 5_000 })
      .toMatch(/Open|Not started|To do/i);
    await child.unroute("**/api/v1/occurrences/**/status");
    await childContext.close();
  });

  test("AT12: held pre-clear History body cannot restore cleared work", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(testInfo.project.name !== "chromium", "Chromium History hold/release");
    await page.setViewportSize({ width: 390, height: 844 });

    await openAsManager(page);
    const title = `AT12 Hist ${Date.now().toString(36)}`;
    await createResponsibilityViaUi(page, title, ["Hist step"]);

    const { context: childContext, page: child, displayName: averyName } =
      await openAveryChild(browser);
    await child.goto("/");
    await expectSignedInAs(child, averyName);
    const card = child.locator(".occurrence").filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: /Mark Hist step completed/i }).click();
    await expect(card).toHaveAttribute("data-completed", "true", { timeout: 20_000 });
    await childContext.close();

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^History/i })
      .click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await page.getByRole("button", { name: /Filters/i }).click();
    await page.getByLabel("Work").selectOption("responsibility");
    await expect(page.getByRole("button", { name: new RegExp(title) }).first()).toBeVisible({
      timeout: 20_000,
    });

    const staleRes = await page.request.get("/api/v1/history?kind=responsibility");
    expect(staleRes.ok()).toBeTruthy();
    const staleJson = await staleRes.json();
    expect(JSON.stringify(staleJson)).toMatch(new RegExp(title));
    const staleBody = JSON.stringify(staleJson);
    const staleGeneration = (staleJson as { activityGeneration: number }).activityGeneration;

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^Settings/i })
      .click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: /Clear activity history/i }).click();
    await expect(page.getByRole("heading", { name: /Clear activity history\?/i })).toBeVisible();
    await page.getByRole("button", { name: "Clear history", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /Activity history was cleared/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Household" })
      .getByRole("button", { name: /^History/i })
      .click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Filters/i }).click();
    await page.getByLabel("Work").selectOption("responsibility");
    const clearedApi = await page.request.get("/api/v1/history?kind=responsibility");
    expect(clearedApi.ok()).toBeTruthy();
    const clearedJson = (await clearedApi.json()) as {
      activityGeneration: number;
      occurrences: Array<{ title: string; completed?: boolean }>;
    };
    expect(clearedJson.activityGeneration).toBeGreaterThan(staleGeneration);
    expect(
      clearedJson.occurrences.some((o) => new RegExp(title).test(o.title) && o.completed),
    ).toBe(false);

    let releaseStale!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    let held = false;
    await page.route("**/api/v1/history**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      if (!held) {
        held = true;
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

    // Trigger a post-clear History reload, hold the pre-clear completed body, then release it.
    await page.getByLabel("Work").selectOption("");
    await expect.poll(() => held, { timeout: 10_000 }).toBeTruthy();
    releaseStale();
    await page.getByLabel("Work").selectOption("responsibility");
    await expect
      .poll(async () => {
        return page
          .locator(".history-summary-row")
          .filter({ hasText: title })
          .filter({ hasText: /· Complete ·/ })
          .count();
      }, { timeout: 10_000 })
      .toBe(0);
    await page.unroute("**/api/v1/history**");
    await page.getByLabel("Work").selectOption("");
    await page.getByLabel("Work").selectOption("responsibility");
    await expect(
      page
        .locator(".history-summary-row")
        .filter({ hasText: title })
        .filter({ hasText: /· Complete ·/ }),
    ).toHaveCount(0);
  });

  test("AT15: built-shell reload, signed-out resume, denied identity", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      testInfo.project.name !== "chromium",
      "Built production shell (playwright.config) Chromium evidence",
    );
    await page.setViewportSize({ width: 390, height: 844 });

    await openAsManager(page);
    const title = `AT15 Dest ${Date.now().toString(36)}`;
    const definitionId = await createResponsibilityViaUi(page, title, ["Dest step"]);
    const detailPath = `/plan/responsibilities/${definitionId}`;
    expect(page.url()).toContain(detailPath);

    // Built local shell reload of responsibility detail.
    await page.goto(detailPath);
    await expectSignedInAs(page, "Morgan Reed");
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });

    // Signed-out resume returns to the same responsibility destination.
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: /Sign in|Claim/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    const remembered = await page.evaluate(() => sessionStorage.getItem("hd_intended_path"));
    if (!remembered) {
      await page.evaluate(
        (path) => sessionStorage.setItem("hd_intended_path", path),
        detailPath,
      );
    } else {
      expect(remembered).toContain(definitionId);
    }

    await page.getByLabel("Login name").fill(MANAGER_LOGIN);
    await page.getByLabel("Passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: /Sign in/i }).click();
    await expectSignedInAs(page, "Morgan Reed");
    await expect
      .poll(() => page.url(), { timeout: 20_000 })
      .toContain(detailPath);
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });

    // Unavailable / unauthorized identity for a random responsibility id.
    const missingId = crypto.randomUUID();
    await page.goto(`/plan/responsibilities/${missingId}`);
    await expect(
      page.getByText(/This responsibility is unavailable|This view is unavailable/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Child without manage cannot use the editor destination as a manager would.
    const { context: childContext, page: child, displayName: averyName } =
      await openAveryChild(browser);
    await child.goto(detailPath);
    await expectSignedInAs(child, averyName);
    // Same-household members may read configuration; create destination remains gated.
    await child.goto("/plan/responsibilities/new");
    await expect(
      child.getByText(/This view is unavailable|This responsibility is unavailable/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    await childContext.close();
  });
});
