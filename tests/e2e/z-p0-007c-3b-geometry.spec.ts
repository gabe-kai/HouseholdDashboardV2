import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

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

async function openWallWithPromotedTask(
  page: Page,
  request: APIRequestContext,
): Promise<string> {
  await ensureManagerSession(request);
  const title = `Geo promote ${Date.now().toString(36)}`;
  const createTask = await request.post("/api/v1/personal-tasks", {
    headers: await mutatingHeaders(request),
    data: {
      title,
      visibility: "household",
      showOnSharedDashboard: true,
    },
  });
  expect(createTask.ok(), await createTask.text()).toBeTruthy();

  const create = await request.post("/api/v1/displays", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      label: `Geo3B ${Date.now().toString(36)}`,
    },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const code = ((await create.json()) as { enrollment: { code: string } })
    .enrollment.code;

  await page.goto("/display");
  await expect(page.getByTestId("display-setup")).toBeVisible();
  await page.getByTestId("display-claim-code").fill(code);
  await page.getByRole("button", { name: "Connect display" }).click();
  await expect(page.getByTestId("display-overview")).toBeVisible({
    timeout: 20_000,
  });
  return title;
}

test.describe("P0-007C-3B geometry", () => {
  test("AT8: promoted personal summaries visible and overflow-free", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "webkit",
      "Geometry coverage runs on Chromium projects",
    );
    const title = await openWallWithPromotedTask(page, request);
    await page.getByTestId("display-org-by-work").click();
    const section = page.getByTestId("display-promoted-personal");
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section.getByText(title)).toBeVisible();
    const box = await section.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(80);
    expect(box!.height).toBeGreaterThan(24);
  });
});
