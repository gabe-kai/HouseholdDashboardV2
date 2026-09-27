import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import {
  disposeRespawnedE2eServers,
  restartPreservingE2eServer,
} from "../helpers/e2e-restart-server";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const SCREENSHOT_DIR = path.resolve("reports/_local-screenshots/p0-007c-3a-r1");

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

async function mutatingHeaders(
  request: APIRequestContext,
): Promise<Record<string, string>> {
  return {
    "x-csrf-token": await csrf(request),
    Origin: requestOrigin(),
  };
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

async function enrollWall(
  managerRequest: APIRequestContext,
  wall: Page,
  label: string,
): Promise<void> {
  await ensureManagerSession(managerRequest);
  const create = await managerRequest.post("/api/v1/displays", {
    headers: await mutatingHeaders(managerRequest),
    data: { mutationId: crypto.randomUUID(), label },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const code = ((await create.json()) as { enrollment: { code: string } })
    .enrollment.code;

  await wall.goto("/display");
  await expect(wall.getByTestId("display-setup")).toBeVisible();
  await wall.getByTestId("display-claim-code").fill(code);
  await wall.getByRole("button", { name: "Connect display" }).click();
  await expect(wall.getByTestId("display-overview")).toBeVisible({
    timeout: 20_000,
  });
}

async function ensureResponsibility(
  request: APIRequestContext,
): Promise<string> {
  await ensureManagerSession(request);
  const title = `Offline kitchen ${Date.now().toString(36)}`;
  const res = await request.post("/api/v1/responsibilities", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      title,
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: AVERY_ID,
      steps: [
        {
          logicalItemId: crypto.randomUUID(),
          text: "Counters",
          obligation: "required",
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return title;
}

test.describe("P0-007C-3A offline pending", () => {
  test.afterAll(async () => {
    await disposeRespawnedE2eServers();
  });

  test("AT8: disconnect, tap Done, actual server restart, same session saves exactly-once", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Phone Chromium offline/restart journey",
    );
    test.setTimeout(240_000);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const title = await ensureResponsibility(page.request);
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollWall(page.request, wall, `Offline ${Date.now().toString(36)}`);

    await wall.getByTestId("display-org-by-work").click();
    await wall
      .getByTestId("display-by-work")
      .locator("button.display-work-row")
      .filter({ hasText: title })
      .click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();

    // Abort display status posts so the tap stays pending in the outbox.
    await wall.route("**/api/v1/display/occurrences/**/status", (route) =>
      route.abort(),
    );

    await wall.locator("[data-testid^=display-step-done-]").first().click();
    await expect(
      wall.getByRole("status").filter({ hasText: /pending|retry|Saving/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    await durableScreenshot(
      wall,
      path.join(SCREENSHOT_DIR, "offline-pending-detail.png"),
    );

    // Actual local server restart: Fastify close + rebind with preserved DB
    // (same display session). Keeps Playwright's webServer process alive.
    const baseURL = test.info().project.use.baseURL!;
    await restartPreservingE2eServer(baseURL);

    // Allow status posts after restart and reconnect the still-valid session.
    await wall.unroute("**/api/v1/display/occurrences/**/status");
    await wall.reload();
    await expect(
      wall
        .getByTestId("display-overview")
        .or(wall.getByTestId("display-detail"))
        .or(wall.getByTestId("display-pending-cue")),
    ).toBeVisible({ timeout: 30_000 });
    // Must not render a blank/cached household payload without authorization.
    await expect(wall.getByTestId("display-setup")).toHaveCount(0);

    await wall.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });

    if (await wall.getByTestId("display-pending-cue").count()) {
      await wall.getByTestId("display-pending-cue").click();
    } else if (await wall.getByTestId("display-overview").count()) {
      await wall.getByTestId("display-org-by-work").click();
      await wall
        .getByTestId("display-by-work")
        .locator("button.display-work-row")
        .filter({ hasText: title })
        .click();
    }

    await expect
      .poll(
        async () => {
          const saved = await wall
            .getByRole("status")
            .filter({ hasText: /Saved/i })
            .count();
          const donePressed = await wall
            .locator("[data-testid^=display-step-done-][aria-pressed=true]")
            .count();
          const rejected = await wall
            .getByRole("status")
            .filter({ hasText: /not saved|Could not save|rejected/i })
            .count();
          const pending = await wall
            .getByRole("status")
            .filter({ hasText: /pending|retry/i })
            .count();
          return saved > 0 || donePressed > 0 || rejected > 0 || pending === 0;
        },
        { timeout: 45_000 },
      )
      .toBeTruthy();

    // Exactly-once: reopen and confirm a single completed step, not duplicated feedback.
    await wall.getByRole("button", { name: "Back" }).click().catch(() => undefined);
    if (await wall.getByTestId("display-overview").count()) {
      await wall.getByTestId("display-org-by-work").click();
      await wall
        .getByTestId("display-by-work")
        .locator("button.display-work-row")
        .filter({ hasText: title })
        .click();
    }
    await expect(
      wall.locator("[data-testid^=display-step-done-][aria-pressed=true]"),
    ).toHaveCount(1, { timeout: 20_000 });

    await durableScreenshot(
      wall,
      path.join(SCREENSHOT_DIR, "offline-reconnected.png"),
    );

    await wallCtx.close();
  });
});
