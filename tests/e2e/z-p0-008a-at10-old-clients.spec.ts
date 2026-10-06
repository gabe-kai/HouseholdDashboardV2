import { test, expect, type Page } from "@playwright/test";
import { expectSignedInAs, revealChecklist } from "../helpers/e2e-shell";
import {
  disposeRespawnedE2eServers,
  restartPreservingE2eServer,
  wipeAndRebindE2eServer,
} from "../helpers/e2e-restart-server";

const OWNER_SECRET =
  process.env.INSTALLATION_OWNER_SECRET ??
  "e2e-installation-owner-secret-with-enough-entropy-0123456789ab";
const MANAGER_PASS = "Unique-passphrase-ok!999";

async function ownerIssueInvite(page: Page): Promise<string> {
  await page.context().clearCookies();
  await page.goto("/owner");
  await expect(page.getByTestId("owner-secret-input")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("owner-secret-input").fill(OWNER_SECRET);
  await page.getByTestId("owner-secret-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("owner-console")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("owner-issue-invite").click();
  await expect(page.getByTestId("owner-invite-link")).toBeVisible();
  return page.getByTestId("owner-invite-link").inputValue();
}

async function completeAccountForm(
  page: Page,
  loginName: string,
  displayName: string,
): Promise<void> {
  await expect(page.getByTestId("setup-account-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("setup-display-name").fill(displayName);
  await page.getByTestId("setup-login-name").fill(loginName);
  await page.getByTestId("setup-passphrase").fill(MANAGER_PASS);
  await page.getByTestId("setup-account-form").locator("button[type=submit]").click();
}

async function completeHouseholdForm(page: Page, householdName: string): Promise<void> {
  await expect(page.getByTestId("setup-household-form")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("setup-household-name").fill(householdName);
  await page.getByTestId("setup-timezone-confirm").check();
  await page.getByTestId("setup-household-form").locator("button[type=submit]").click();
  await expect(page.getByTestId("setup-complete")).toBeVisible({ timeout: 20_000 });
}

async function csrfFrom(page: Page): Promise<string> {
  const session = await page.request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { csrfToken: string }).csrfToken;
}

async function createResponsibility(
  page: Page,
  title: string,
  accountableMemberId: string,
): Promise<void> {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const res = await page.request.post("/api/v1/responsibilities", {
    headers: {
      Origin: origin,
      "x-csrf-token": await csrfFrom(page),
    },
    data: {
      mutationId: crypto.randomUUID(),
      title,
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId,
      steps: [{ text: "Feed", obligation: "required" }],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

async function resetHousehold(page: Page): Promise<void> {
  await page.goto("/household/settings");
  await expect(page.getByTestId("reset-household-section")).toBeVisible();
  await page.getByRole("button", { name: /Reset household/i }).click();
  await expect(page.getByTestId("reset-household-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("reset-confirm-text").fill("RESET");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("reset-passphrase").fill(MANAGER_PASS);
  await Promise.all([
    page.waitForURL(/\/welcome/, { timeout: 60_000 }),
    page.getByTestId("reset-submit").click(),
  ]);
  await expect(page.getByTestId("protected-welcome")).toBeVisible({ timeout: 30_000 });
}

test.describe("P0-008A AT10 old live clients", () => {
  test.afterAll(async () => {
    await disposeRespawnedE2eServers();
  });

  test.beforeEach(async ({ baseURL, context }) => {
    test.skip(!baseURL, "baseURL required");
    await context.clearCookies();
    await wipeAndRebindE2eServer(baseURL);
  });

  test("AT10: pending member/display outboxes, reset socket blanking, restart, reconnect", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium-008a",
      "Multi-context Chromium-008a AT10 journey",
    );
    test.setTimeout(300_000);
    test.skip(!baseURL, "baseURL required");

    const loginName = `at10.${Date.now().toString(36)}`;
    const householdName = "AT10 Reuse Household";
    const workTitle = `AT10 Cats ${Date.now().toString(36)}`;

    const inviteLink = await ownerIssueInvite(page);
    await page.goto(inviteLink);
    await completeAccountForm(page, loginName, "AT10 Manager");
    await completeHouseholdForm(page, householdName);
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, "AT10 Manager");

    const session = await page.request.get("/api/v1/auth/session");
    expect(session.ok()).toBeTruthy();
    const memberId = ((await session.json()) as { member: { id: string } }).member.id;
    await createResponsibility(page, workTitle, memberId);

    // Second live member context (old client that will reconnect after reset).
    const staleCtx = await browser.newContext();
    const staleMember = await staleCtx.newPage();
    await staleMember.goto("/today");
    await expect(staleMember.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 20_000,
    });
    await staleMember.getByLabel("Login name").fill(loginName);
    await staleMember.getByLabel("Passphrase").fill(MANAGER_PASS);
    await staleMember.getByRole("button", { name: "Sign in" }).click();
    await expectSignedInAs(staleMember, "AT10 Manager");

    // Display wall with live socket.
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    const wallSockets: import("@playwright/test").WebSocket[] = [];
    wall.on("websocket", (ws) => {
      if (/\/api\/v1\/display\/sync/.test(ws.url())) wallSockets.push(ws);
    });
    const create = await page.request.post("/api/v1/displays", {
      headers: {
        Origin: new URL(baseURL).origin,
        "x-csrf-token": await csrfFrom(page),
      },
      data: { mutationId: crypto.randomUUID(), label: "AT10 wall" },
    });
    expect(create.ok(), await create.text()).toBeTruthy();
    const code = ((await create.json()) as { enrollment: { code: string } }).enrollment
      .code;
    await wall.goto("/display");
    await expect(wall.getByTestId("display-setup")).toBeVisible();
    await wall.getByTestId("display-claim-code").fill(code);
    await wall.getByRole("button", { name: "Connect display" }).click();
    await expect(wall.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => wallSockets.length, { timeout: 20_000 })
      .toBeGreaterThan(0);
    const wallWsClose = new Promise<void>((resolve) => {
      const open = wallSockets[wallSockets.length - 1]!;
      open.on("close", () => resolve());
    });

    // Queue pending member + display taps (do not reach the server).
    await staleMember.route("**/api/v1/occurrences/**/status", (route) => route.abort());
    await wall.route("**/api/v1/display/occurrences/**/status", (route) => route.abort());

    await staleMember.goto("/today");
    const memberCard = staleMember.locator(".occurrence").filter({ hasText: workTitle });
    await expect(memberCard).toBeVisible({ timeout: 20_000 });
    await revealChecklist(memberCard);
    await memberCard.getByRole("button", { name: /Mark Feed completed/ }).click();
    await expect(staleMember.locator(".status-pill[data-kind='pending']")).toBeVisible({
      timeout: 15_000,
    });

    await wall.getByTestId("display-org-by-work").click();
    await wall
      .getByTestId("display-by-work")
      .locator("button.display-work-row")
      .filter({ hasText: workTitle })
      .click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();
    await wall.locator("[data-testid^=display-step-done-]").first().click();
    await expect(
      wall.getByRole("status").filter({ hasText: /pending|retry|Saving/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Reset from the initiator context while old clients remain live.
    await resetHousehold(page);

    // Display: reset-specific socket close + visible retirement / blanking.
    await wallWsClose;
    await expect(wall.getByTestId("display-blank")).toBeVisible({ timeout: 30_000 });
    await expect(wall.getByTestId("display-blank")).toContainText(/reset/i);
    await expect(wall.getByTestId("display-retired-notices")).toBeVisible({
      timeout: 15_000,
    });
    await expect(wall.getByTestId("display-retired-notice").first()).toContainText(
      /reset/i,
    );
    await expect(wall.getByTestId("display-overview")).toHaveCount(0);

    // Old member: release routes and force outbox flush → visible retirement notice.
    await staleMember.unroute("**/api/v1/occurrences/**/status");
    await staleMember.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    await expect(staleMember.getByTestId("installation-reset-banner")).toBeVisible({
      timeout: 30_000,
    });
    await expect(staleMember.getByTestId("installation-reset-banner")).toContainText(
      /reset/i,
    );

    // Restart preserves replacement epoch; old contexts must not resurrect data.
    await restartPreservingE2eServer(baseURL);
    await expect
      .poll(async () => {
        try {
          const health = await fetch(`${baseURL}/api/v1/health`);
          return health.ok;
        } catch {
          return false;
        }
      }, { timeout: 60_000 })
      .toBeTruthy();

    if (await wall.getByTestId("display-blank-continue").count()) {
      await wall.getByTestId("display-blank-continue").click();
    }
    await expect(
      wall.getByTestId("display-setup").or(wall.getByTestId("display-blank")),
    ).toBeVisible({ timeout: 20_000 });
    await expect(wall.getByTestId("display-overview")).toHaveCount(0);

    await staleMember.reload();
    await expect(staleMember.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 30_000,
    });
    // Retirement notice may still be present on the sign-in shell after reload.
    await expect(
      staleMember.getByTestId("installation-reset-banner").or(
        staleMember.getByRole("heading", { name: "Sign in" }),
      ).first(),
    ).toBeVisible();

    // New household with reused names; old cookies stay useless.
    await expect
      .poll(async () => {
        try {
          const health = await fetch(`${baseURL}/api/v1/health`);
          return health.ok;
        } catch {
          return false;
        }
      }, { timeout: 60_000 })
      .toBeTruthy();
    const invite2 = await ownerIssueInvite(page);
    await page.goto(invite2);
    await completeAccountForm(page, loginName, "AT10 Manager");
    await completeHouseholdForm(page, householdName);
    await page.getByTestId("setup-go-today").click();
    await expectSignedInAs(page, "AT10 Manager");

    const oldSession = await staleMember.request.get("/api/v1/auth/session");
    expect(oldSession.status()).toBe(401);

    // Same-epoch offline retry still works for the new household.
    const newSession = await page.request.get("/api/v1/auth/session");
    const newMemberId = ((await newSession.json()) as { member: { id: string } }).member
      .id;
    const retryTitle = `AT10 Retry ${Date.now().toString(36)}`;
    await createResponsibility(page, retryTitle, newMemberId);
    await page.goto("/today");
    await page.route("**/api/v1/occurrences/**/status", (route) => route.abort());
    const retryCard = page.locator(".occurrence").filter({ hasText: retryTitle });
    await expect(retryCard).toBeVisible({ timeout: 20_000 });
    await revealChecklist(retryCard);
    await retryCard.getByRole("button", { name: /Mark Feed completed/ }).click();
    await expect(page.locator(".status-pill[data-kind='pending']")).toBeVisible();
    await page.unroute("**/api/v1/occurrences/**/status");
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect
      .poll(async () => page.locator(".status-pill[data-kind='pending']").count(), {
        timeout: 30_000,
      })
      .toBe(0);

    await staleCtx.close();
    await wallCtx.close();
  });
});
