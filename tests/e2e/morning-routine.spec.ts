import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

const PARENT_ID = "22222222-2222-4222-8222-222222222201";
const JAMIE_ID = "22222222-2222-4222-8222-222222222202";
const RILEY_ID = "22222222-2222-4222-8222-222222222203";

async function apiEnsureRoutine(request: APIRequestContext) {
  await request.post("/api/v1/session", { data: { memberId: PARENT_ID } });
  const current = await request.get("/api/v1/routines");
  const body = (await current.json()) as { routine: { id: string } | null };
  if (!body.routine) {
    const res = await request.post("/api/v1/routines", {
      data: {
        title: "Morning Routine",
        assigneeMemberIds: [JAMIE_ID, RILEY_ID],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        steps: [
          { text: "Make bed", obligation: "required" },
          { text: "Pack lunch", obligation: "as_needed" },
          { text: "Stretch", obligation: "optional" },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
  }
  await request.delete("/api/v1/session");
}

async function selectProfile(page: Page, name: string) {
  await page.goto("/");
  await expect(page.locator(".eval-banner")).toContainText(/EVALUATION BUILD/i);
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.locator(".topbar")).toContainText(name);
}

async function expandAllOccurrences(page: Page) {
  for (let i = 0; i < 10; i++) {
    const collapsed = page.locator(".occurrence-header[aria-expanded='false']");
    if ((await collapsed.count()) === 0) break;
    await collapsed.first().click();
  }
}

async function ensureRoutine(page: Page) {
  await apiEnsureRoutine(page.request);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Jamie Child/ })).toBeVisible();
}

async function openChildToday(page: Page) {
  await selectProfile(page, "Jamie Child");
  await expect(page.getByRole("heading", { name: "Morning Routine", exact: true }).first()).toBeVisible();
  await expandAllOccurrences(page);
}

test.describe("P0-001 shared morning routine", () => {
  test("child rapid checklist stays optimistic under delayed mutations", async ({ page }) => {
    await ensureRoutine(page);
    await page.goto("/?mutationDelayMs=1200");
    await page.getByRole("button", { name: /^Jamie Child/ }).click();
    await expect(page.getByRole("heading", { name: "Morning Routine", exact: true }).first()).toBeVisible();
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

    // Visible state must update before the 1200ms delayed responses return.
    await expect(page.getByTestId(/step-status-/).nth(0)).toContainText("Completed");
    await expect(page.getByTestId(/step-status-/).nth(1)).toContainText("Completed");
    await expect(page.getByTestId(/step-status-/).nth(2)).toContainText("Completed");
    expect(Date.now() - t0).toBeLessThan(1200);

    await expect(page.locator(".status-pill[data-kind='pending']")).toBeVisible();
    await expect(page.locator(".status-pill[data-kind='pending']")).toHaveCount(0, { timeout: 20_000 });
  });

  test("pending outbox survives reload during API interruption", async ({ page }) => {
    await ensureRoutine(page);
    await openChildToday(page);

    await page.getByRole("button", { name: /Mark Make bed open/ }).click();
    await expect(page.locator(".status-pill[data-kind='pending']")).toHaveCount(0, { timeout: 15_000 });

    await page.route("**/api/v1/occurrences/**", (route) => route.abort());

    await page.getByRole("button", { name: /Mark Make bed completed/ }).click();
    await page.getByRole("button", { name: /Mark Pack lunch not needed/ }).click();
    await expect(page.locator(".status-pill[data-kind='pending']")).toBeVisible();

    await page.reload();
    await expect(page.locator(".topbar")).toContainText("Jamie Child");
    await expect(page.locator(".status-pill[data-kind='pending']")).toBeVisible();

    const count = await page.evaluate(async () => {
      return await new Promise<number>((resolve, reject) => {
        const req = indexedDB.open("keyval-store");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("keyval", "readonly");
          const store = tx.objectStore("keyval");
          const getReq = store.get("hd-outbox-v1");
          getReq.onsuccess = () => {
            const value = getReq.result as unknown[] | undefined;
            resolve(Array.isArray(value) ? value.length : 0);
          };
          getReq.onerror = () => reject(getReq.error);
        };
      });
    });
    expect(count).toBeGreaterThan(0);

    await page.unroute("**/api/v1/occurrences/**");
    await page.reload();
    await expect(page.locator(".status-pill[data-kind='pending']")).toHaveCount(0, { timeout: 20_000 });
  });

  test("parent sees child progress via sync and recovers after reconnect", async ({ browser }) => {
    const parentContext = await browser.newContext();
    const childContext = await browser.newContext();
    const parent = await parentContext.newPage();
    const child = await childContext.newPage();

    await apiEnsureRoutine(parent.request);
    await selectProfile(parent, "Alex Parent");
    await expect(parent.getByRole("heading", { name: "Household progress", exact: true })).toBeVisible();
    await expandAllOccurrences(parent);

    await openChildToday(child);
    await child.getByRole("button", { name: /Mark Make bed open/ }).click();
    await expect(child.locator(".status-pill[data-kind='pending']")).toHaveCount(0, { timeout: 15_000 });

    await child.getByRole("button", { name: /Mark Make bed completed/ }).click();
    await expect(parent.getByText("Status: Completed").first()).toBeVisible({ timeout: 2000 });

    await parent.route("**/api/v1/sync**", (route) => route.abort());
    await child.getByRole("button", { name: /Mark Pack lunch not needed/ }).click();
    await expect(child.locator(".status-pill[data-kind='pending']")).toHaveCount(0, { timeout: 15_000 });

    await parent.unroute("**/api/v1/sync**");
    await parent.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    await parent.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Today", exact: true }).click();
    await expandAllOccurrences(parent);
    await expect(parent.getByText("Status: Not needed").first()).toBeVisible({ timeout: 8000 });

    await parentContext.close();
    await childContext.close();
  });

  test("phone viewport accessibility basics", async ({ page }) => {
    await ensureRoutine(page);
    await openChildToday(page);

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
