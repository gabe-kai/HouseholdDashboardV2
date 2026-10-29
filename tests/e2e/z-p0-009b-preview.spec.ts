import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";
import { clickFamilyControl } from "../helpers/p0-009b";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const AVERY_ID = "22222222-2222-4222-8222-222222222202";

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

async function csrfHeaders(request: APIRequestContext) {
  const session = await request.get("/api/v1/auth/session");
  expect(session.ok()).toBeTruthy();
  const csrfToken = ((await session.json()) as { csrfToken: string }).csrfToken;
  return { "x-csrf-token": csrfToken, Origin: requestOrigin() };
}

async function enrollWall(request: APIRequestContext, wall: Page, label: string) {
  await ensureManagerSession(request);
  const create = await request.post("/api/v1/displays", {
    headers: await csrfHeaders(request),
    data: { mutationId: crypto.randomUUID(), label },
  });
  expect(create.ok(), await create.text()).toBeTruthy();
  const body = (await create.json()) as {
    display: { id: string };
    enrollment: { code: string };
  };
  await wall.goto("/display");
  await wall.getByTestId("display-claim-code").fill(body.enrollment.code);
  await wall.getByRole("button", { name: "Connect display" }).click();
  await expect(wall.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
  return body.display.id;
}

test.describe("P0-009B family wall preview", () => {
  test("AT19a/AT19b/AT19c: preview board is readonly and does not steer the wall", async ({
    page,
    browser,
  }) => {
    await ensureManagerSession(page.request);
    await page.request.post("/api/v1/routines", {
      headers: await csrfHeaders(page.request),
      data: {
        mutationId: crypto.randomUUID(),
        title: `Preview ${Date.now().toString(36)}`,
        daypart: "morning",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assigneeMemberIds: [AVERY_ID],
        assigneeGroupIds: [],
        steps: [{ logicalItemId: crypto.randomUUID(), text: "Hold this step", obligation: "required" }],
      },
    });
    const wallContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const wall = await wallContext.newPage();
    const displayId = await enrollWall(page.request, wall, `Preview wall ${Date.now().toString(36)}`);
    await clickFamilyControl(wall, `family-upcoming-${AVERY_ID}`);
    await expect(wall.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "upcoming");

    await page.goto("/household/displays");
    await expectSignedInAs(page, "Morgan Reed");
    const preview = page.getByRole("button", { name: "Preview display" }).first();
    await preview.click();
    await expect(page.getByTestId("display-preview-only")).toBeVisible();
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    await expect(frame.locator("[data-testid^='display-step-done-']")).toHaveCount(0);
    const posts: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "GET" && req.url().includes("/api/v1/display")) {
        posts.push(`${req.method()} ${req.url()}`);
      }
    });
    await clickFamilyControl(frame, `family-enlarge-${AVERY_ID}`);
    await expect(frame.getByTestId(`family-back-${AVERY_ID}`)).toBeVisible();
    expect(posts.filter((row) => row.includes("/status") || row.includes("/claim"))).toEqual([]);
    await expect(wall.getByTestId(`family-pane-${AVERY_ID}`)).toHaveAttribute("data-section", "upcoming");
    await page.reload();
    await expect(page.getByTestId("display-preview-only")).toBeVisible();
    const reloaded = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(reloaded.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    const proof = await page.request.get("/family-board-proof.html");
    if (proof.ok()) {
      const proofText = await proof.text();
      expect(proofText).not.toContain("p0-009a-family-board-crowded-r2");
      expect(proofText).not.toMatch(/School|Meals|Calendar placeholder/i);
    } else {
      expect(proof.status()).toBe(404);
    }
    await wallContext.close();
    expect(displayId).toBeTruthy();
  });

  test("AT13a/AT19a: preview person-day omits private work and shows the shared board", async ({
    page,
  }) => {
    await ensureManagerSession(page.request);
    await page.request.post("/api/v1/personal-tasks", {
      headers: await csrfHeaders(page.request),
      data: { title: "PRIVATE-PREVIEW-TITLE", visibility: "private" },
    });
    const created = await page.request.post("/api/v1/displays", {
      headers: await csrfHeaders(page.request),
      data: { mutationId: crypto.randomUUID(), label: `Prev ${Date.now().toString(36)}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const displayId = ((await created.json()) as { display: { id: string } }).display.id;
    const previewDay = await page.request.get(
      `/api/v1/displays/${displayId}/preview/people/${AVERY_ID}/day`,
    );
    expect(previewDay.ok()).toBeTruthy();
    const bodyText = await previewDay.text();
    expect(bodyText).not.toContain("PRIVATE-PREVIEW-TITLE");
    expect(bodyText).not.toMatch(/intendedStructure|logicalItemId|csrf/i);
    await page.goto(`/household/displays/${displayId}/preview`);
    await expect(page.getByTestId("display-preview-only")).toBeVisible();
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByTestId(`family-pane-${AVERY_ID}`)).toBeVisible();
  });
});
