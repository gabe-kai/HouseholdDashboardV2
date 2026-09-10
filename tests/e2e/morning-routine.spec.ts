import { test, expect, type Page, type APIRequestContext, type Browser } from "@playwright/test";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_LOGIN = "e2e.avery";
const JORDAN_LOGIN = "e2e.jordan";
const MORGAN_ID = "22222222-2222-4222-8222-222222222201";
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

async function ensureSharedRoutine(request: APIRequestContext, assignees = [MORGAN_ID, AVERY_ID, JORDAN_ID]) {
  const listed = await request.get("/api/v1/routines");
  expect(listed.ok()).toBeTruthy();
  const body = (await listed.json()) as { routine: { id: string } | null };
  if (body.routine) return body.routine;
  const created = await request.post("/api/v1/routines", {
    headers: await mutatingHeaders(request),
    data: {
      title: "Morning Routine",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: assignees,
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Pack lunch", obligation: "as_needed" },
        { text: "Stretch", obligation: "optional" },
      ],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return ((await created.json()) as { routine: { id: string } }).routine;
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  await ensureSharedRoutine(page.request);
  await page.goto("/");
  await expect(page.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
}

async function claimChild(
  request: APIRequestContext,
  membershipId: string,
  loginName: string,
  displayName: string,
  options?: { ensureRoutine?: boolean; preset?: "direct_personalizer" | "proposal_personalizer" },
) {
  await ensureManagerSession(request);
  if (options?.ensureRoutine !== false) {
    await ensureSharedRoutine(request);
  }
  const enroll = await request.post("/api/v1/enrollment/claims", {
    headers: await mutatingHeaders(request),
    data: { membershipId, preset: options?.preset ?? "direct_personalizer" },
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

async function expandAllOccurrences(page: Page) {
  for (let i = 0; i < 10; i++) {
    const collapsed = page.locator(
      ".occurrence-header:not([aria-expanded='true']), .occurrence-header[aria-expanded='false']",
    );
    if ((await collapsed.count()) === 0) break;
    await collapsed.first().click();
    await page.waitForTimeout(50);
  }
}

async function outboxCount(page: Page, membershipId: string): Promise<number> {
  return page.evaluate(async (id) => {
    return await new Promise<number>((resolve, reject) => {
      const req = indexedDB.open("keyval-store");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("keyval", "readonly");
        const store = tx.objectStore("keyval");
        const getReq = store.get(`hd-outbox-v1:${id}`);
        getReq.onsuccess = () => {
          const value = getReq.result as unknown[] | undefined;
          resolve(Array.isArray(value) ? value.length : 0);
        };
        getReq.onerror = () => reject(getReq.error);
      };
    });
  }, membershipId);
}

async function ensureStepOpen(page: Page, stepName: string) {
  const markPattern = new RegExp(`Mark ${stepName}`);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await page.getByRole("button", { name: markPattern }).count()) > 0) break;
    const header = page.locator("article.occurrence button.occurrence-header").first();
    if ((await header.count()) === 0) {
      await page.waitForTimeout(200);
      continue;
    }
    await header.click({ force: true });
    await page.waitForTimeout(150);
  }
  const open = page.getByRole("button", { name: new RegExp(`Mark ${stepName} open`) });
  await expect(open).toBeVisible({ timeout: 15_000 });
  const pressed = await open.getAttribute("aria-pressed");
  if (pressed !== "true") {
    await open.click();
    await expect(page.locator(".status-pill[data-kind='pending']")).toHaveCount(0, {
      timeout: 20_000,
    });
  }
}

test.describe("P0-002 authenticated household", () => {
  test("newly assigned routine checklist syncs both ways without manual refresh", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const managerContext = await browser.newContext();
    const childContext = await browser.newContext();
    const manager = await managerContext.newPage();
    const child = await childContext.newPage();

    await ensureManagerSession(manager.request);
    await claimChild(child.request, AVERY_ID, AVERY_LOGIN, "Avery Reed", {
      ensureRoutine: false,
    });

    await child.goto("/");
    await expect(child.locator(".topbar")).toContainText("Avery Reed", { timeout: 20_000 });
    await expect(
      child.getByText("No Morning Routine for you on this household date."),
    ).toBeVisible();
    await expect(child.locator(".status-pill[data-kind='online']")).toContainText("Online", {
      timeout: 10_000,
    });

    await manager.goto("/");
    await expect(manager.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
    await expect(manager.locator(".status-pill[data-kind='online']")).toContainText("Online", {
      timeout: 10_000,
    });
    await manager
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();

    await ensureSharedRoutine(manager.request, [MORGAN_ID, AVERY_ID, JORDAN_ID]);

    await expect(child.getByRole("button", { name: /Mark Make bed completed/ })).toBeVisible({
      timeout: 4_000,
    });
    await expect(child.getByRole("button", { name: /Mark Pack lunch completed/ })).toBeVisible({
      timeout: 4_000,
    });

    await expandAllOccurrences(manager);
    await expect(manager.getByText("Avery Reed").first()).toBeVisible({ timeout: 4_000 });

    await child.getByRole("button", { name: /Mark Make bed completed/ }).click();
    await expect(manager.getByText("Status: Completed").first()).toBeVisible({ timeout: 4_000 });

    await managerContext.close();
    await childContext.close();
  });

  test("manager claims, opens Today, and sees checklist actions", async ({ page }) => {
    await openAsManager(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Today", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: /Today|Morning|Household/i }).first()).toBeVisible();
    await expandAllOccurrences(page);
    await expect(page.getByRole("button", { name: /Mark .+ completed/ }).first()).toBeVisible();
  });

  test("child rapid checklist stays optimistic under delayed mutations", async ({ page }) => {
    await claimChild(page.request, AVERY_ID, AVERY_LOGIN, "Avery Reed");
    await page.goto("/?mutationDelayMs=2000");
    await expect(page.locator(".topbar")).toContainText("Avery Reed", { timeout: 20_000 });
    await expandAllOccurrences(page);

    const doneButtons = page.getByRole("button", { name: /Mark .+ completed/ });
    await expect(doneButtons).toHaveCount(3);
    const openButtons = page.getByRole("button", { name: /Mark .+ open/ });
    await openButtons.nth(0).click();
    await openButtons.nth(1).click();
    await openButtons.nth(2).click();
    await expect(page.locator(".status-pill[data-kind='pending']")).toHaveCount(0, { timeout: 20_000 });

    const t0 = Date.now();
    await doneButtons.nth(0).click();
    await doneButtons.nth(1).click();
    await doneButtons.nth(2).click();
    await expect(page.getByTestId(/step-status-/).nth(0)).toContainText("Completed");
    await expect(page.getByTestId(/step-status-/).nth(1)).toContainText("Completed");
    await expect(page.getByTestId(/step-status-/).nth(2)).toContainText("Completed");
    await expect(page.locator(".status-pill[data-kind='pending']")).toBeVisible();
    expect(Date.now() - t0).toBeLessThan(2500);
    await expect(page.locator(".status-pill[data-kind='pending']")).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test("pending outbox survives reload during API interruption", async ({ page }) => {
    await claimChild(page.request, AVERY_ID, AVERY_LOGIN, "Avery Reed");
    await page.goto("/");
    await expect(page.locator(".topbar")).toContainText("Avery Reed", { timeout: 20_000 });
    await ensureStepOpen(page, "Make bed");
    await ensureStepOpen(page, "Pack lunch");

    await page.route("**/api/v1/occurrences/**", (route) => route.abort());
    await page.getByRole("button", { name: /Mark Make bed completed/ }).click();
    await page.getByRole("button", { name: /Mark Pack lunch not needed/ }).click();
    await expect(page.locator(".status-pill[data-kind='pending']")).toBeVisible();

    await page.reload();
    await expect(page.locator(".topbar")).toContainText("Avery Reed");
    await expect(page.locator(".status-pill[data-kind='pending']")).toBeVisible();
    expect(await outboxCount(page, AVERY_ID)).toBeGreaterThan(0);

    await page.unroute("**/api/v1/occurrences/**");
    await page.reload();
    await expect(page.locator(".status-pill[data-kind='pending']")).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test("shared-browser identity switch does not drain another membership outbox", async ({
    page,
  }) => {
    await claimChild(page.request, AVERY_ID, AVERY_LOGIN, "Avery Reed");
    await page.goto("/");
    await expect(page.locator(".topbar")).toContainText("Avery Reed", { timeout: 20_000 });
    await ensureStepOpen(page, "Make bed");

    await page.route("**/api/v1/occurrences/**", (route) => route.abort());
    await page.getByRole("button", { name: /Mark Make bed completed/ }).click();
    await expect(page.locator(".status-pill[data-kind='pending']")).toBeVisible();
    expect(await outboxCount(page, AVERY_ID)).toBeGreaterThan(0);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: /Sign in|Claim/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    expect(await outboxCount(page, AVERY_ID)).toBe(0);

    await ensureManagerSession(page.request);
    await page.goto("/");
    await expect(page.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
    expect(await outboxCount(page, MORGAN_ID)).toBe(0);
    expect(await outboxCount(page, AVERY_ID)).toBe(0);
  });

  test("manager sees child progress via sync and recovers after reconnect", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const managerContext = await browser.newContext();
    const childContext = await browser.newContext();
    const manager = await managerContext.newPage();
    const child = await childContext.newPage();

    await ensureManagerSession(manager.request);
    await ensureSharedRoutine(manager.request);
    await claimChild(child.request, AVERY_ID, AVERY_LOGIN, "Avery Reed");

    await manager.goto("/");
    await expect(manager.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
    await manager
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Household", exact: true })
      .click();
    await expandAllOccurrences(manager);

    await child.goto("/");
    await expect(child.locator(".topbar")).toContainText("Avery Reed", { timeout: 20_000 });
    await ensureStepOpen(child, "Make bed");
    await ensureStepOpen(child, "Pack lunch");

    await child.getByRole("button", { name: /Mark Make bed completed/ }).click();
    await expect(manager.getByText("Status: Completed").first()).toBeVisible({ timeout: 4000 });

    // Drop the live socket without a full page reload; reconnect + authoritative read
    // must recover the next commit without relying on manual refresh.
    await manager.evaluate(() => {
      (
        window as unknown as { __hdSync?: { closeForTest: () => void } }
      ).__hdSync?.closeForTest();
    });
    await expect(manager.locator(".status-pill[data-kind='online']")).toContainText(
      /Reconnecting|Online/,
      { timeout: 10_000 },
    );
    await expect(manager.locator(".status-pill[data-kind='online']")).toContainText("Online", {
      timeout: 20_000,
    });

    await child.getByRole("button", { name: /Mark Pack lunch not needed/ }).click();
    await expect(child.locator(".status-pill[data-kind='pending']")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(manager.getByText("Status: Not needed").first()).toBeVisible({ timeout: 8000 });
    await expect(manager.locator(".occurrence").filter({ hasText: "Avery Reed" })).toContainText(
      "Complete",
    );

    await managerContext.close();
    await childContext.close();
  });

  test("manager approval updates open personalize proposal status without reload", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const managerContext = await browser.newContext();
    const childContext = await browser.newContext();
    const manager = await managerContext.newPage();
    const child = await childContext.newPage();

    await ensureManagerSession(manager.request);
    await ensureSharedRoutine(manager.request);
    await claimChild(child.request, JORDAN_ID, JORDAN_LOGIN, "Jordan Reed", {
      preset: "proposal_personalizer",
    });

    await child.goto("/");
    await expect(child.locator(".topbar")).toContainText("Jordan Reed", { timeout: 20_000 });
    await expect(child.locator(".status-pill[data-kind='online']")).toContainText("Online", {
      timeout: 10_000,
    });
    await child
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Personalize", exact: true })
      .click();
    await child.getByLabel("Item text").fill("Pack soccer bag");
    await child.getByRole("button", { name: "Send proposal" }).click();
    await expect(child.getByText("Pack soccer bag")).toBeVisible({ timeout: 10_000 });
    await expect(
      child.locator(".simple-list li").filter({ hasText: "Pack soccer bag" }).getByText("Pending"),
    ).toBeVisible();

    await manager.goto("/");
    await expect(manager.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
    await expect(manager.locator(".status-pill[data-kind='online']")).toContainText("Online", {
      timeout: 10_000,
    });
    await manager
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Approvals", exact: true })
      .click();
    await manager.getByRole("button", { name: "Approve Pack soccer bag" }).click();
    await expect(manager.getByText(/Effective/i).first()).toBeVisible({ timeout: 15_000 });

    await expect(
      child.locator(".simple-list li").filter({ hasText: "Pack soccer bag" }).getByText("Approved"),
    ).toBeVisible({ timeout: 4_000 });

    // Future-effective: approved item is previewable, but not on Today's executable checklist yet.
    await manager.getByRole("button", { name: "Open read-only preview" }).click();
    await expect(manager.getByText(/Pack soccer bag/i).first()).toBeVisible({ timeout: 10_000 });
    await child
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Today", exact: true })
      .click();
    await expect(child.getByRole("button", { name: /Mark Pack soccer bag/ })).toHaveCount(0);

    await managerContext.close();
    await childContext.close();
  });

  test("direct personalization shows effective-date feedback and preview", async ({ page }) => {
    await claimChild(page.request, AVERY_ID, AVERY_LOGIN, "Avery Reed");
    await page.goto("/");
    await expect(page.locator(".topbar")).toContainText("Avery Reed", { timeout: 20_000 });
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Personalize", exact: true })
      .click();
    await page.getByRole("button", { name: "Add personal item" }).click();
    await page.getByLabel("Item text").fill("Clean up breakfast");
    await page.getByRole("button", { name: "Save personal settings" }).click();
    await expect(page.getByText(/Effective/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Open read-only preview" }).click();
    await expect(page.getByText(/Clean up breakfast|Read-only preview/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("child cannot reach shared routine editor; manager can", async ({ page }) => {
    await claimChild(page.request, AVERY_ID, AVERY_LOGIN, "Avery Reed");
    await page.goto("/");
    await expect(page.locator(".topbar")).toContainText("Avery Reed", { timeout: 20_000 });
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Routine", exact: true }),
    ).toHaveCount(0);

    const listed = await page.request.get("/api/v1/routines");
    const routineId = ((await listed.json()) as { routine: { id: string } | null }).routine?.id;
    expect(routineId).toBeTruthy();
    const denied = await page.request.post(`/api/v1/routines/${routineId}/revisions`, {
      headers: await mutatingHeaders(page.request),
      data: {
        title: "Hijack",
        weekdays: [1],
        assigneeMemberIds: [AVERY_ID],
        steps: [{ text: "Nope", obligation: "required" }],
      },
    });
    expect(denied.status()).toBe(403);

    await openAsManager(page);
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Routine", exact: true }),
    ).toBeVisible();
  });

  test("phone viewport accessibility basics", async ({ page }) => {
    await claimChild(page.request, JORDAN_ID, JORDAN_LOGIN, "Jordan Reed");
    await page.goto("/");
    await expect(page.locator(".topbar")).toContainText("Jordan Reed", { timeout: 20_000 });
    await expandAllOccurrences(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);

    const done = page.getByRole("button", { name: /Mark Make bed completed/ });
    await done.focus();
    await expect(done).toBeFocused();

    await page.addStyleTag({
      content: `* { color: #111 !important; background: #fff !important; border-color: #333 !important; }`,
    });
    await expect(page.getByText(/Status:/).first()).toBeVisible();
    await expect(page.locator(".status-pill").first()).toBeVisible();
  });
});
