import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { durableScreenshot } from "../helpers/durable-screenshot";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
const AVERY_LOGIN = "e2e.avery";
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
  expect(boot.status()).toBe(409);
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: MANAGER_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function claimAvery(request: APIRequestContext) {
  await ensureManagerSession(request);
  const enroll = await request.post("/api/v1/enrollment/claims", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      membershipId: AVERY_ID,
      preset: "direct_personalizer",
    },
  });
  if (enroll.ok()) {
    const token = ((await enroll.json()) as { claim: { token: string } }).claim
      .token;
    await request.post("/api/v1/auth/logout", {
      headers: await mutatingHeaders(request),
    });
    const claim = await request.post("/api/v1/auth/claim", {
      headers: { Origin: requestOrigin() },
      data: {
        claimToken: token,
        loginName: AVERY_LOGIN,
        passphrase: PASSPHRASE,
        displayName: "Avery Reed",
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  await request.post("/api/v1/auth/logout", {
    headers: await mutatingHeaders(request),
  });
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: requestOrigin() },
    data: { loginName: AVERY_LOGIN, passphrase: PASSPHRASE },
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

async function ensureAssignedWork(request: APIRequestContext): Promise<{
  routineTitle: string;
  responsibilityTitle: string;
}> {
  await ensureManagerSession(request);
  const suffix = Date.now().toString(36);
  const routineTitle = `Wall stretch ${suffix}`;
  const responsibilityTitle = `Kitchen wall ${suffix}`;
  const headers = await mutatingHeaders(request);

  const routine = await request.post("/api/v1/routines", {
    headers,
    data: {
      mutationId: crypto.randomUUID(),
      title: routineTitle,
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [AVERY_ID],
      assigneeGroupIds: [],
      steps: [
        {
          logicalItemId: crypto.randomUUID(),
          text: "Stretch hard",
          obligation: "required",
        },
        {
          logicalItemId: crypto.randomUUID(),
          text: "Stretch soft",
          obligation: "as_needed",
        },
      ],
    },
  });
  expect(routine.ok(), await routine.text()).toBeTruthy();

  const responsibility = await request.post("/api/v1/responsibilities", {
    headers,
    data: {
      mutationId: crypto.randomUUID(),
      title: responsibilityTitle,
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      accountableMemberId: AVERY_ID,
      steps: [
        {
          logicalItemId: crypto.randomUUID(),
          text: "Counters",
          obligation: "required",
        },
        {
          logicalItemId: crypto.randomUUID(),
          text: "Wipe",
          obligation: "as_needed",
        },
      ],
    },
  });
  expect(responsibility.ok(), await responsibility.text()).toBeTruthy();

  return { routineTitle, responsibilityTitle };
}

test.describe("P0-007C-3A display execution", () => {
  test("AT3/AT4/AT11 light: enroll, open work, Done/Not needed, converge", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Phone Chromium execution journey",
    );
    test.setTimeout(180_000);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const { routineTitle, responsibilityTitle } = await ensureAssignedWork(
      page.request,
    );

    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollWall(
      page.request,
      wall,
      `Exec ${Date.now().toString(36)}`,
    );

    // By person → Avery → open routine occurrence → Done + Not needed
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
      .filter({ hasText: routineTitle })
      .click();
    await expect(wall.getByText(/Avery/i).first()).toBeVisible();

    const doneBtn = wall.locator("[data-testid^=display-step-done-]").first();
    await expect(doneBtn).toBeVisible({ timeout: 15_000 });
    await doneBtn.click();
    await expect(
      wall.getByRole("status").filter({ hasText: /Saved|pending|retry/i }).first(),
    ).toBeVisible({ timeout: 20_000 });

    const notNeeded = wall
      .locator("[data-testid^=display-step-not-needed-]")
      .first();
    if (await notNeeded.count()) {
      await notNeeded.click();
      await expect(
        wall.getByRole("status").filter({ hasText: /Saved|pending|retry/i }).first(),
      ).toBeVisible({ timeout: 20_000 });
    }

    await durableScreenshot(
      wall,
      path.join(SCREENSHOT_DIR, "execution-routine-detail.png"),
    );

    await wall.getByRole("button", { name: "Back", exact: true }).click();
    // Person detail → overview
    if ((await wall.getByTestId("display-overview").count()) === 0) {
      await wall.getByRole("button", { name: "Back", exact: true }).click();
    }
    await expect(wall.getByTestId("display-overview")).toBeVisible({
      timeout: 10_000,
    });

    // By work → responsibility Done
    await wall.getByTestId("display-org-by-work").click();
    await expect(wall.getByTestId("display-by-work")).toBeVisible();
    await wall
      .getByTestId("display-by-work")
      .locator("button.display-work-row")
      .filter({ hasText: responsibilityTitle })
      .click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();
    await expect(wall.getByText(/Avery/i).first()).toBeVisible();
    await wall.locator("[data-testid^=display-step-done-]").first().click();
    await expect(
      wall.getByRole("status").filter({ hasText: /Saved|pending|retry/i }).first(),
    ).toBeVisible({ timeout: 20_000 });

    await durableScreenshot(
      wall,
      path.join(SCREENSHOT_DIR, "execution-responsibility-detail.png"),
    );

    // Human Today converges without reload of wall state — Avery phone sees progress.
    const averyCtx = await browser.newContext();
    const avery = await averyCtx.newPage();
    await claimAvery(avery.request);
    await avery.goto("/today");
    await expectSignedInAs(avery, /Avery/);
    await expect(
      avery.getByText(new RegExp(responsibilityTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")),
    ).toBeVisible({ timeout: 20_000 });

    await wallCtx.close();
    await averyCtx.close();
  });
});
