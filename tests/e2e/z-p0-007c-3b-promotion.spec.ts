import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";
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

test.describe("P0-007C-3B personal wall promotion", () => {
  test("AT2/AT8 light: promote household task; wall summaries show it without status controls", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Phone Chromium owner + wall journey",
    );
    test.setTimeout(180_000);

    const title = `Promote wall ${Date.now().toString(36)}`;
    await claimAvery(page.request);
    await page.goto("/today");
    await expectSignedInAs(page, /Avery/);

    await page.getByRole("button", { name: "Add task" }).click();
    await page.getByPlaceholder("Add a personal task").fill(title);
    await page.getByLabel("Task visibility").selectOption("household");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });

    const row = page.locator(".activity-entry").filter({ hasText: title });
    await row.getByLabel("Shared dashboard").click();
    await expect(row.getByText(/Shared dashboard/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const managerCtx = await browser.newContext();
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollWall(
      managerCtx.request,
      wall,
      `Wall ${Date.now().toString(36)}`,
    );

    await wall.getByTestId("display-org-by-work").click();
    await expect(wall.getByTestId("display-promoted-personal")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      wall.getByTestId("display-promoted-personal").getByText(title),
    ).toBeVisible();
    await expect(
      wall.getByTestId("display-promoted-personal").getByRole("button"),
    ).toHaveCount(0);

    await wall.getByTestId("display-org-by-person").click();
    await expect
      .poll(
        async () => {
          const text = await wall
            .locator("[data-testid^=display-person-promoted-]")
            .allTextContents();
          return text.some((t) => t.includes(title));
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();

    await row.getByLabel("Shared dashboard").click();
    await wall.getByTestId("display-org-by-work").click();
    await expect
      .poll(
        async () => {
          const section = wall.getByTestId("display-promoted-personal");
          if ((await section.count()) === 0) return true;
          return (await section.getByText(title).count()) === 0;
        },
        { timeout: 40_000 },
      )
      .toBeTruthy();

    await managerCtx.close();
    await wallCtx.close();
  });

  test("AT6: dual walls withdraw on private; delayed older dashboard cannot resurrect", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Phone Chromium multi-context recovery",
    );
    test.setTimeout(180_000);

    const title = `Withdraw wall ${Date.now().toString(36)}`;
    await claimAvery(page.request);
    await page.goto("/today");
    await expectSignedInAs(page, /Avery/);

    await page.getByRole("button", { name: "Add task" }).click();
    await page.getByPlaceholder("Add a personal task").fill(title);
    await page.getByLabel("Task visibility").selectOption("household");
    await page.getByRole("checkbox", { name: /Show on shared dashboard/i }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page
        .locator(".activity-entry")
        .filter({ hasText: title })
        .getByText(/Shared dashboard/i)
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    const managerCtx = await browser.newContext();
    const wallACtx = await browser.newContext();
    const wallBCtx = await browser.newContext();
    const wallA = await wallACtx.newPage();
    const wallB = await wallBCtx.newPage();
    await enrollWall(managerCtx.request, wallA, `WallA ${Date.now().toString(36)}`);
    await enrollWall(managerCtx.request, wallB, `WallB ${Date.now().toString(36)}`);

    for (const wall of [wallA, wallB]) {
      await wall.getByTestId("display-org-by-work").click();
      await expect(
        wall.getByTestId("display-promoted-personal").getByText(title),
      ).toBeVisible({ timeout: 30_000 });
    }

    let releaseOlder: (() => void) | null = null;
    const olderGate = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    let heldCount = 0;
    await wallB.route("**/api/v1/display/dashboard**", async (route) => {
      if (heldCount === 0) {
        heldCount += 1;
        await olderGate;
        const response = await route.fetch();
        const json = (await response.json()) as Record<string, unknown>;
        json.promotedPersonalTasks = [
          {
            id: "00000000-0000-4000-8000-000000000099",
            title,
            ownerMembershipId: AVERY_ID,
            ownerDisplayName: "Avery",
          },
        ];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(json),
        });
        return;
      }
      await route.continue();
    });

    const row = page.locator(".activity-entry").filter({ hasText: title });
    await row.getByLabel("Visibility").selectOption("private");

    await wallA.getByTestId("display-org-by-work").click();
    await expect
      .poll(
        async () => {
          const section = wallA.getByTestId("display-promoted-personal");
          if ((await section.count()) === 0) return true;
          return (await section.getByText(title).count()) === 0;
        },
        { timeout: 40_000 },
      )
      .toBeTruthy();

    await wallB.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect
      .poll(
        async () => {
          const section = wallB.getByTestId("display-promoted-personal");
          if ((await section.count()) === 0) return true;
          return (await section.getByText(title).count()) === 0;
        },
        { timeout: 40_000 },
      )
      .toBeTruthy();

    releaseOlder?.();
    await wallB.waitForTimeout(500);
    await expect
      .poll(
        async () => {
          const section = wallB.getByTestId("display-promoted-personal");
          if ((await section.count()) === 0) return true;
          return (await section.getByText(title).count()) === 0;
        },
        { timeout: 15_000 },
      )
      .toBeTruthy();

    await managerCtx.close();
    await wallACtx.close();
    await wallBCtx.close();
  });
});
