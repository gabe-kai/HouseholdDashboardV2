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

async function enrollDisplayCookie(
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
  const code = ((await create.json()) as { enrollment: { code: string } }).enrollment
    .code;

  await managerRequest.post("/api/v1/auth/logout", {
    headers: await mutatingHeaders(managerRequest),
  });

  await wall.goto("/display");
  await expect(wall.getByTestId("display-setup")).toBeVisible();
  await wall.getByTestId("display-claim-code").fill(code);
  await wall.getByRole("button", { name: "Connect display" }).click();
  await expect(wall.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
}

async function assertDisplayShellNoMemberChrome(page: Page) {
  await expect(page.getByTestId("display-shell")).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByTestId("display-overview").or(page.getByTestId("display-setup")),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Plan", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Household", exact: true })).toHaveCount(
    0,
  );
}

test.describe("P0-007C-2 bootstrap isolation", () => {
  test("AT15: with display cookie, /today and /plan mount DisplayApp without member fetches", async ({
    page,
    browser,
  }) => {
    const wallCtx = await browser.newContext();
    const wall = await wallCtx.newPage();
    await enrollDisplayCookie(
      page.request,
      wall,
      `Iso ${Date.now().toString(36)}`,
    );

    const memberAttempts: string[] = [];
    const memberPath = (url: string) =>
      /\/api\/v1\/(today|auth\/session|people|personal-tasks|sync)(\?|$)/.test(
        new URL(url).pathname,
      ) && !url.includes("/api/v1/display/");

    wall.on("request", (request) => {
      const url = request.url();
      if (memberPath(url)) {
        memberAttempts.push(`${request.method()} ${url}`);
      }
    });

    for (const path of ["/today", "/plan"]) {
      memberAttempts.length = 0;
      await wall.goto(path);
      await assertDisplayShellNoMemberChrome(wall);
      await expect
        .poll(() => new URL(wall.url()).pathname)
        .toMatch(/^\/display/);
      expect(
        memberAttempts,
        `member API attempts on ${path}: ${memberAttempts.join(", ")}`,
      ).toEqual([]);
    }

    await wallCtx.close();
  });
});
