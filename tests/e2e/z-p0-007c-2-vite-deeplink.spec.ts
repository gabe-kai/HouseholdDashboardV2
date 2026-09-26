import { test, expect, type APIRequestContext } from "@playwright/test";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";

function requestOrigin(): string {
  const base = test.info().project.use.baseURL;
  if (!base) throw new Error("Playwright project baseURL is required");
  return new URL(base).origin;
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

test.describe("P0-007C-2 Vite development deep links", () => {
  test("Vite serves /display cold load without personal App chrome", async ({ page }) => {
    await page.goto("/display");
    await expect(page.getByTestId("display-shell")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("display-setup")).toBeVisible();
    await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Plan", exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("display-setup")).toBeVisible();
  });

  test("Vite serves /household/displays for manager", async ({ page }) => {
    await ensureManagerSession(page.request);
    await page.goto("/household/displays");
    await expect(page.getByTestId("household-displays")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Household displays" })).toBeVisible();
  });

  test("P0-007C-2 AT15 Vite: display cookie keeps /today and /plan in DisplayApp", async ({
    page,
    browser,
  }) => {
    await ensureManagerSession(page.request);
    const create = await page.request.post("/api/v1/displays", {
      headers: {
        Origin: requestOrigin(),
        "x-csrf-token": (
          (await (await page.request.get("/api/v1/auth/session")).json()) as {
            csrfToken: string;
          }
        ).csrfToken,
      },
      data: { mutationId: crypto.randomUUID(), label: `ViteIso ${Date.now().toString(36)}` },
    });
    expect(create.ok(), await create.text()).toBeTruthy();
    const code = ((await create.json()) as { enrollment: { code: string } }).enrollment
      .code;
    await page.request.post("/api/v1/auth/logout", {
      headers: {
        Origin: requestOrigin(),
        "x-csrf-token": (
          (await (await page.request.get("/api/v1/auth/session")).json()) as {
            csrfToken: string;
          }
        ).csrfToken,
      },
    });

    const wall = await browser.newContext();
    const wallPage = await wall.newPage();
    await wallPage.goto("/display");
    await wallPage.getByTestId("display-claim-code").fill(code);
    await wallPage.getByRole("button", { name: "Connect display" }).click();
    await expect(wallPage.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });

    const memberAttempts: string[] = [];
    const memberPath = (url: string) =>
      /\/api\/v1\/(today|auth\/session|people|personal-tasks|sync)(\?|$)/.test(
        new URL(url).pathname,
      ) && !url.includes("/api/v1/display/");

    wallPage.on("request", (request) => {
      const url = request.url();
      if (memberPath(url)) {
        memberAttempts.push(`${request.method()} ${url}`);
      }
    });

    for (const path of ["/today", "/plan"]) {
      memberAttempts.length = 0;
      await wallPage.goto(path);
      await expect(wallPage.getByTestId("display-shell")).toBeVisible({ timeout: 20_000 });
      await expect(wallPage.getByRole("button", { name: "Today", exact: true })).toHaveCount(
        0,
      );
      expect(memberAttempts, path).toEqual([]);
    }

    await wall.close();
  });
});
