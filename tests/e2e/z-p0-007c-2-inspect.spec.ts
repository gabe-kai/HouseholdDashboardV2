import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";

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

async function enrollFreshDisplay(
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
  const code = ((await create.json()) as { enrollment: { code: string } }).enrollment.code;

  await wall.addInitScript(() => {
    window.__HD_DISPLAY_IDLE_MS = 2000;
  });
  await wall.goto("/display");
  await expect(wall.getByTestId("display-setup")).toBeVisible();
  await wall.getByTestId("display-claim-code").fill(code);
  await wall.getByRole("button", { name: "Connect display" }).click();
  await expect(wall.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
}

test.describe("P0-007C-2 wall inspection", () => {
  test("AT7: By person/By work switch, detail, idle return", async ({ page, browser }) => {
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollFreshDisplay(page.request, wall, `Inspect ${Date.now().toString(36)}`);

    await expect(wall.getByTestId("display-org-by-person")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await wall.getByTestId("display-org-by-work").click();
    await expect(wall.getByTestId("display-by-work")).toBeVisible();
    await wall.getByTestId("display-org-by-person").click();
    await expect(wall.getByTestId("display-by-person")).toBeVisible();

    const personButton = wall.getByTestId("display-by-person").locator("button").first();
    await personButton.click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();
    await expect(wall.getByRole("button", { name: "Back", exact: true })).toBeVisible();
    // No execution controls
    await expect(wall.getByRole("checkbox")).toHaveCount(0);
    await expect(wall.getByRole("button", { name: /complete|mark done/i })).toHaveCount(0);

    await wall.getByRole("button", { name: "Back", exact: true }).click();
    await expect(wall.getByTestId("display-overview")).toBeVisible();

    // Re-open and wait for idle return (2s via __HD_DISPLAY_IDLE_MS).
    await personButton.click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();
    await expect(wall.getByTestId("display-overview")).toBeVisible({ timeout: 8_000 });

    // By work detail path when work rows exist
    await wall.getByTestId("display-org-by-work").click();
    const workRow = wall.getByTestId("display-by-work").locator("button.display-work-row").first();
    if (await workRow.count()) {
      await workRow.click();
      await expect(wall.getByTestId("display-detail")).toBeVisible();
      await wall.getByRole("button", { name: "Back", exact: true }).click();
      await expect(wall.getByTestId("display-overview")).toBeVisible();
    }

    await wallCtx.close();
  });

  test("AT5/AT7: household-visible task only in owner person detail", async ({
    page,
    browser,
  }) => {
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollFreshDisplay(page.request, wall, `Task ${Date.now().toString(36)}`);

    const AVERY_ID = "22222222-2222-4222-8222-222222222202";
    const CASEY_ID = "22222222-2222-4222-8222-222222222204";
    const AVERY_LOGIN = "e2e.avery";
    const taskTitle = `Household visible ${Date.now().toString(36)}`;
    const privateTitle = `PRIVATE_ONLY_${Date.now().toString(36)}`;

    const averyCtx = await browser.newContext();
    const avery = await averyCtx.newPage();
    await ensureManagerSession(avery.request);
    const enroll = await avery.request.post("/api/v1/enrollment/claims", {
      headers: await mutatingHeaders(avery.request),
      data: {
        mutationId: crypto.randomUUID(),
        membershipId: AVERY_ID,
        preset: "direct_personalizer",
      },
    });
    if (enroll.ok()) {
      const token = ((await enroll.json()) as { claim: { token: string } }).claim
        .token;
      await avery.request.post("/api/v1/auth/logout", {
        headers: await mutatingHeaders(avery.request),
      });
      const claim = await avery.request.post("/api/v1/auth/claim", {
        headers: { Origin: requestOrigin() },
        data: {
          claimToken: token,
          loginName: AVERY_LOGIN,
          passphrase: PASSPHRASE,
          displayName: "Avery Reed",
        },
      });
      expect(claim.ok(), await claim.text()).toBeTruthy();
    } else {
      await avery.request.post("/api/v1/auth/logout", {
        headers: await mutatingHeaders(avery.request),
      });
      const login = await avery.request.post("/api/v1/auth/login", {
        headers: { Origin: requestOrigin() },
        data: { loginName: AVERY_LOGIN, passphrase: PASSPHRASE },
      });
      expect(login.ok(), await login.text()).toBeTruthy();
    }

    const createVisible = await avery.request.post("/api/v1/personal-tasks", {
      headers: await mutatingHeaders(avery.request),
      data: { title: taskTitle, visibility: "household" },
    });
    expect(createVisible.ok(), await createVisible.text()).toBeTruthy();
    const createPrivate = await avery.request.post("/api/v1/personal-tasks", {
      headers: await mutatingHeaders(avery.request),
      data: { title: privateTitle, visibility: "private" },
    });
    expect(createPrivate.ok(), await createPrivate.text()).toBeTruthy();

    // Wall By person resting: task title NOT in overview/counts.
    await wall.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(wall.getByTestId("display-overview")).toBeVisible();
    await expect(wall.getByText(taskTitle)).toHaveCount(0);
    await expect(wall.getByText(privateTitle)).toHaveCount(0);

    // Open Avery detail: household-visible task visible; private never.
    await wall.locator(`#display-person-${AVERY_ID}`).click();
    await expect(wall.getByTestId("display-detail")).toBeVisible({ timeout: 20_000 });
    await expect(wall.getByText(taskTitle)).toBeVisible({ timeout: 20_000 });
    await expect(wall.getByText(privateTitle)).toHaveCount(0);

    await wall.getByRole("button", { name: "Back", exact: true }).click();
    await expect(wall.getByTestId("display-overview")).toBeVisible();

    // Open another person detail: task NOT visible.
    await wall.locator(`#display-person-${CASEY_ID}`).click();
    await expect(wall.getByTestId("display-detail")).toBeVisible();
    await expect(wall.getByText(taskTitle)).toHaveCount(0);
    await expect(wall.getByText(privateTitle)).toHaveCount(0);

    await averyCtx.close();
    await wallCtx.close();
  });

  test("AT15: /household/displays is grant-gated; /display never mounts personal App", async ({
    page,
    browser,
  }) => {
    await ensureManagerSession(page.request);
    await page.goto("/household/displays");
    await expectSignedInAs(page, "Morgan Reed");
    await expect(page.getByTestId("household-displays")).toBeVisible();

    const wall = await browser.newContext();
    const wallPage = await wall.newPage();
    await wallPage.goto("/display");
    await expect(wallPage.getByTestId("display-shell")).toBeVisible();
    await expect(wallPage.getByTestId("display-setup")).toBeVisible();
    await expect(wallPage.getByRole("button", { name: "Plan", exact: true })).toHaveCount(0);
    await wall.close();
  });
});
