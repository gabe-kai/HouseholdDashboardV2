import { test, expect, type Page } from "@playwright/test";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const CHILD_LOGIN = "e2e.avery";
const MORGAN_ID = "22222222-2222-4222-8222-222222222201";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";

async function requestOrigin(page: Page): Promise<string> {
  const health = await page.request.get("/api/v1/health");
  expect(health.ok()).toBeTruthy();
  return new URL(health.url()).origin;
}

async function ensureManagerSession(page: Page) {
  const boot = await page.request.post("/api/v1/test/bootstrap-claim");
  if (boot.ok()) {
    const { token } = (await boot.json()) as { token: string };
    const claim = await page.request.post("/api/v1/auth/claim", {
      data: {
        claimToken: token,
        loginName: MANAGER_LOGIN,
        passphrase: PASSPHRASE,
        displayName: "Morgan Reed",
      },
    });
    expect(claim.ok(), `claim failed: ${await claim.text()}`).toBeTruthy();
    return;
  }

  expect(boot.status(), `bootstrap failed: ${await boot.text()}`).toBe(409);
  const login = await page.request.post("/api/v1/auth/login", {
    data: { loginName: MANAGER_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), `login failed: ${await login.text()}`).toBeTruthy();
}

async function csrf(page: Page): Promise<string> {
  const session = await page.request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  return ((await session.json()) as { csrfToken: string }).csrfToken;
}

async function mutatingHeaders(page: Page): Promise<Record<string, string>> {
  return {
    "x-csrf-token": await csrf(page),
    Origin: await requestOrigin(page),
  };
}

/** Creates today's shared routine with Morgan + Avery if none exists yet. */
async function ensureSharedRoutine(page: Page) {
  const listed = await page.request.get("/api/v1/routines");
  expect(listed.ok()).toBeTruthy();
  const body = (await listed.json()) as { routine: { id: string } | null };
  if (body.routine) return body.routine;

  const created = await page.request.post("/api/v1/routines", {
    headers: await mutatingHeaders(page),
    data: {
      title: "Morning Routine",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [MORGAN_ID, AVERY_ID],
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Brush teeth", obligation: "required" },
      ],
    },
  });
  expect(created.ok(), `create routine failed: ${await created.text()}`).toBeTruthy();
  return ((await created.json()) as { routine: { id: string } }).routine;
}

async function openAsManager(page: Page) {
  await ensureManagerSession(page);
  await ensureSharedRoutine(page);
  await page.goto("/");
  await expect(page.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
}

test.describe("P0-002 authenticated household", () => {
  test("manager claims, creates routine, and opens Today", async ({ page }) => {
    await openAsManager(page);

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("button", { name: "Today", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: /Today|Morning/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Mark .+ completed/ }).first()).toBeVisible();
  });

  test("enrolled child can act on checklist with delayed responses", async ({ page }) => {
    await ensureManagerSession(page);
    await ensureSharedRoutine(page);

    const enroll = await page.request.post("/api/v1/enrollment/claims", {
      headers: await mutatingHeaders(page),
      data: {
        membershipId: AVERY_ID,
        preset: "direct_personalizer",
      },
    });
    expect(enroll.ok(), await enroll.text()).toBeTruthy();
    const enrollBody = (await enroll.json()) as { claim: { token: string } };

    await page.request.post("/api/v1/auth/logout", {
      headers: await mutatingHeaders(page),
    });

    const childClaim = await page.request.post("/api/v1/auth/claim", {
      data: {
        claimToken: enrollBody.claim.token,
        loginName: CHILD_LOGIN,
        passphrase: PASSPHRASE,
        displayName: "Avery Reed",
      },
    });
    expect(childClaim.ok(), await childClaim.text()).toBeTruthy();

    await page.goto("/?mutationDelayMs=2000");
    await expect(page.locator(".topbar")).toContainText("Avery Reed", { timeout: 20_000 });

    const collapsed = page.locator(".occurrence-header[aria-expanded='false']");
    if (await collapsed.count()) await collapsed.first().click();

    const done = page.getByRole("button", { name: /Mark .+ completed/ });
    await expect(done.first()).toBeVisible({ timeout: 15_000 });
    await done.first().click();
    await expect(page.getByText(/Status: Completed/i).first()).toBeVisible();
    await expect(page.locator(".status-pill[data-kind='pending']")).toBeVisible();
    await expect(page.locator(".status-pill[data-kind='pending']")).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test("phone viewport has no horizontal overflow", async ({ page }) => {
    await openAsManager(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});
