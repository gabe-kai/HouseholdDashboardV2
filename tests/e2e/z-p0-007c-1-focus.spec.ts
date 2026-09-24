import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

const PASSPHRASE = "unique-passphrase-ok!";
const AVERY_LOGIN = "e2e.avery";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";

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

async function claimAvery(request: APIRequestContext) {
  await ensureManagerRequest(request);
  const enroll = await request.post("/api/v1/enrollment/claims", {
    headers: await mutatingHeaders(request),
    data: {
      mutationId: crypto.randomUUID(),
      membershipId: AVERY_ID,
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
        loginName: AVERY_LOGIN,
        passphrase: PASSPHRASE,
        displayName: "Avery Reed",
      },
    });
    expect(claim.ok(), await claim.text()).toBeTruthy();
    return;
  }
  await request.post("/api/v1/auth/logout", { headers: await mutatingHeaders(request) });
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: requestOrigin() },
    data: { loginName: AVERY_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function triggerVisibilityRefresh(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test.describe("P0-007C-1 focus retention", () => {
  test("AT3: manual Later focus and collapse survive visibility/sync refresh", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(
      testInfo.project.name === "chromium-desktop",
      "Phone Chromium/WebKit own this journey",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const suffix = Date.now().toString(36);
    const nextTitle = `C1 Focus Next ${suffix}`;
    const laterTitle = `C1 Focus Later ${suffix}`;

    await ensureManagerRequest(page.request);
    const after = await page.request.post("/api/v1/routines", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: nextTitle,
        daypart: "after_school",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [AVERY_ID],
        assigneeGroupIds: [],
        steps: [{ text: "Homework", obligation: "required" }],
      },
    });
    expect(after.ok(), await after.text()).toBeTruthy();
    const evening = await page.request.post("/api/v1/routines", {
      headers: await mutatingHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: laterTitle,
        daypart: "evening",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [AVERY_ID],
        assigneeGroupIds: [],
        steps: [{ text: "Tidy room", obligation: "required" }],
      },
    });
    expect(evening.ok(), await evening.text()).toBeTruthy();

    const childContext = await browser.newContext();
    const child = await childContext.newPage();
    await claimAvery(child.request);
    const session = await child.request.get("/api/v1/auth/session");
    expect(session.ok()).toBeTruthy();
    const averyName =
      ((await session.json()) as { member?: { displayName?: string } }).member?.displayName ??
      "Avery Reed";

    await child.goto("/");
    await expectSignedInAs(child, averyName);
    await expect(child.getByRole("heading", { name: "Today", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    const nextCard = child.locator(".occurrence").filter({ hasText: nextTitle });
    const laterCard = child.locator(".occurrence").filter({ hasText: laterTitle });
    await expect(nextCard).toHaveAttribute("data-expanded", "true", { timeout: 15_000 });
    await expect(laterCard).toHaveAttribute("data-expanded", "false");

    const laterId = await laterCard.getAttribute("data-testid");
    expect(laterId).toBeTruthy();

    await laterCard.getByRole("button").first().click();
    await expect(laterCard).toHaveAttribute("data-expanded", "true", { timeout: 15_000 });
    await expect(nextCard).toHaveAttribute("data-expanded", "false");

    const refreshPromise = child.waitForResponse(
      (response) => response.url().includes("/api/v1/today") && response.ok(),
      { timeout: 20_000 },
    );
    await triggerVisibilityRefresh(child);
    await refreshPromise.catch(() => undefined);
    await child.waitForTimeout(500);

    await expect(laterCard).toHaveAttribute("data-expanded", "true", { timeout: 15_000 });
    await expect(child.locator(`[data-testid="${laterId}"]`)).toHaveAttribute(
      "data-expanded",
      "true",
    );
    await expect(child.locator('.occurrence[data-expanded="true"]')).toHaveCount(1);

    await laterCard.getByRole("button").first().click();
    await expect(laterCard).toHaveAttribute("data-expanded", "false", { timeout: 15_000 });

    const refreshAfterCollapse = child.waitForResponse(
      (response) => response.url().includes("/api/v1/today") && response.ok(),
      { timeout: 20_000 },
    );
    await triggerVisibilityRefresh(child);
    await refreshAfterCollapse.catch(() => undefined);
    await child.waitForTimeout(500);

    await expect(laterCard).toHaveAttribute("data-expanded", "false", { timeout: 15_000 });
    // Collapse is sticky: refresh must not reopen into auto Next focus.
    await expect(nextCard).toHaveAttribute("data-expanded", "false");
    await expect(child.locator('.occurrence[data-expanded="true"]')).toHaveCount(0);

    await childContext.close();
  });
});
