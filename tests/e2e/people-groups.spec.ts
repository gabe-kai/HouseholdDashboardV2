import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const PASSPHRASE = "unique-passphrase-ok!";
const MANAGER_LOGIN = "e2e.manager";
const SCREENSHOT_DIR = path.resolve("reports/p0-004a-r3-screenshots");

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

async function openAsManager(page: Page) {
  await ensureManagerSession(page.request);
  await page.goto("/");
  await expect(page.locator(".topbar")).toContainText("Morgan Reed", { timeout: 20_000 });
}

test.describe("P0-004A People & Groups focused UX", () => {
  test("phone UI covers focused people, access, groups, and activity", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    await page.getByRole("button", { name: "People & Groups" }).click();
    await expect(page.getByRole("heading", { name: "People & Groups" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add person" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create group" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add person" })).toHaveCount(0);
    await expect(page.getByText("Household-visible personal tasks")).toHaveCount(0);
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "01-overview.png"),
        fullPage: true,
      });
    }

    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByRole("heading", { name: "Add person" })).toBeVisible();
    await page.getByLabel("Name").fill("Elizabeth");
    await page.getByRole("radio", { name: "Child" }).check();
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByRole("heading", { name: "Elizabeth" })).toBeVisible();
    await expect(page.getByText("Role:")).toContainText("Child");
    await expect(page.getByText("Not set up")).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "02-person-detail.png"),
        fullPage: true,
      });
    }

    await page.getByRole("button", { name: "Edit person" }).click();
    await expect(page.getByRole("heading", { name: "Edit person" })).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "03-person-edit.png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: /Back to Elizabeth/i }).click();

    await page.getByRole("button", { name: "Set up access" }).click();
    await expect(page.getByRole("heading", { name: "Access setup" })).toBeVisible();
    await page.getByRole("radio", { name: /Guided member/i }).check();
    // Capture access state before issuance so report artifacts never retain one-time material.
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "04-person-access.png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Prepare access setup" }).click();
    await expect(page.getByText(/Copy this setup material now/i)).toBeVisible();
    await expect(page.locator(".token-box code")).toBeVisible();
    await page.getByRole("button", { name: "Cancel setup" }).click();
    await page.getByRole("button", { name: /Back to Elizabeth/i }).click();
    await page.getByRole("button", { name: "Back to People & Groups" }).click();

    await page.getByRole("button", { name: "Create group" }).click();
    await page.getByLabel("Group name").fill("Kids");
    await page.getByRole("checkbox", { name: "Elizabeth" }).check();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByRole("heading", { name: "Kids" })).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "05-group-detail.png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Edit group" }).click();
    await expect(page.getByRole("heading", { name: /Edit Kids/i })).toBeVisible();
    await page.getByLabel("Group name").fill("Reed kids");
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "06-group-edit.png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByRole("heading", { name: "Reed kids" })).toBeVisible();
    await page.getByRole("button", { name: "Back to People & Groups" }).click();

    await page.getByRole("button", { name: "View household activity" }).click();
    await expect(page.getByRole("heading", { name: "Household activity" })).toBeVisible();
    await page.getByRole("button", { name: "Back to People & Groups" }).click();
    await expect(page.getByRole("button", { name: /Elizabeth/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reed kids/ })).toBeVisible();
  });

  test("open overview converges after peer person create", async ({ browser }) => {
    const managerA = await browser.newContext();
    const managerB = await browser.newContext();
    const pageA = await managerA.newPage();
    const pageB = await managerB.newPage();
    await pageA.setViewportSize({ width: 390, height: 844 });
    await pageB.setViewportSize({ width: 390, height: 844 });

    await openAsManager(pageA);
    await openAsManager(pageB);
    await pageA.getByRole("button", { name: "People & Groups" }).click();
    await pageB.getByRole("button", { name: "People & Groups" }).click();

    const name = `Peer ${Date.now().toString(36)}`;
    await pageA.getByRole("button", { name: "Add person" }).click();
    await pageA.getByLabel("Name").fill(name);
    await pageA.getByRole("radio", { name: "Child" }).check();
    await pageA.getByRole("button", { name: "Add person" }).click();
    await expect(pageA.getByRole("heading", { name })).toBeVisible();
    await pageA.getByRole("button", { name: "Back to People & Groups" }).click();
    await expect(pageB.getByRole("button", { name: new RegExp(name) })).toBeVisible({
      timeout: 15_000,
    });

    await managerA.close();
    await managerB.close();
  });

  test("choice rows and secondary actions meet composed touch geometry", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsManager(page);
    await page.getByRole("button", { name: "People & Groups" }).click();

    await page.getByRole("button", { name: "Add person" }).click();
    await page.getByLabel("Name").fill("Geometry Child");
    await page.getByRole("radio", { name: "Child" }).check();
    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByRole("heading", { name: "Geometry Child" })).toBeVisible();

    const editPerson = page.getByRole("button", { name: "Edit person" });
    const editBox = await editPerson.boundingBox();
    expect(editBox, "Edit person touch target").toBeTruthy();
    expect(editBox!.height).toBeGreaterThanOrEqual(44);

    await editPerson.click();
    await expect(page.getByRole("heading", { name: "Edit person" })).toBeVisible();

    const childRow = page.locator("label.choice-row").filter({ hasText: "Child" });
    await expect(childRow).toBeVisible();
    const composed = await childRow.evaluate((node) => {
      const style = getComputedStyle(node);
      const input = node.querySelector("input");
      if (!input) return null;
      const rowBox = node.getBoundingClientRect();
      const inputBox = input.getBoundingClientRect();
      return {
        display: style.display,
        flexDirection: style.flexDirection,
        rowHeight: rowBox.height,
        inputHeight: inputBox.height,
        inputWidth: inputBox.width,
        // Control should sit beside text, not stacked above it.
        verticalCenterDelta: Math.abs(
          inputBox.top + inputBox.height / 2 - (rowBox.top + rowBox.height / 2),
        ),
        inputLeftOfTextCenter: inputBox.left < rowBox.left + rowBox.width / 2,
      };
    });
    expect(composed).toBeTruthy();
    expect(composed!.display).toBe("flex");
    expect(composed!.flexDirection).toBe("row");
    expect(composed!.rowHeight).toBeGreaterThanOrEqual(44);
    // Native control stays compact; oversized text-field sizing is the regression.
    expect(composed!.inputHeight).toBeLessThan(28);
    expect(composed!.inputWidth).toBeLessThan(28);
    expect(composed!.verticalCenterDelta).toBeLessThan(10);
    expect(composed!.inputLeftOfTextCenter).toBe(true);

    await page.getByRole("button", { name: /Back to Geometry Child/i }).click();
    await page.getByRole("button", { name: "Set up access" }).click();
    const prepare = page.getByRole("button", { name: "Prepare access setup" });
    const prepareBox = await prepare.boundingBox();
    expect(prepareBox!.height).toBeGreaterThanOrEqual(44);

    const guided = page.locator("label.choice-row").filter({ hasText: /Guided member/i });
    const guidedGeom = await guided.evaluate((node) => {
      const input = node.querySelector("input");
      const rowBox = node.getBoundingClientRect();
      const inputBox = input!.getBoundingClientRect();
      return {
        display: getComputedStyle(node).display,
        stacked: inputBox.bottom <= rowBox.top + inputBox.height + 4 && inputBox.height > 36,
        sideBySide: Math.abs(inputBox.top + inputBox.height / 2 - (rowBox.top + rowBox.height / 2)) < 12,
      };
    });
    expect(guidedGeom.display).toBe("flex");
    expect(guidedGeom.sideBySide).toBe(true);
    expect(guidedGeom.stacked).toBe(false);
  });
});
