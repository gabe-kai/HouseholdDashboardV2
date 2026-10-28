import { expect, test, type APIRequestContext } from "@playwright/test";
import { expectSignedInAs } from "../helpers/e2e-shell";

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

test.describe("P0-009A preview geometry", () => {
  test("AT7a/AT7b: iframe layout viewport matches the labeled target and ignores outer resize", async ({
    page,
  }) => {
    await ensureManagerSession(page.request);
    await page.goto("/household/displays");
    await expectSignedInAs(page, "Morgan Reed");
    const label = `Geom ${Date.now().toString(36)}`;
    await page.getByTestId("display-label-input").fill(label);
    await page.getByRole("button", { name: "Add display" }).click();
    await page.getByRole("button", { name: "Preview display" }).first().click();
    await expect(page.getByTestId("display-preview-host")).toBeVisible();
    await expect(page.getByTestId("display-preview-geometry")).toContainText("3840 × 2160");
    await expect(page.getByTestId("display-preview-geometry")).toContainText("assumed");

    const frame = page.locator('[data-testid="display-preview-frame"]');
    await expect(frame).toHaveAttribute("width", "3840");
    await expect(frame).toHaveAttribute("height", "2160");
    const inner = await page.evaluate(() => {
      const iframe = document.querySelector(
        '[data-testid="display-preview-frame"]',
      ) as HTMLIFrameElement | null;
      const win = iframe?.contentWindow;
      if (!win) return null;
      return { width: win.innerWidth, height: win.innerHeight };
    });
    expect(inner).toEqual({ width: 3840, height: 2160 });

    const columnsBefore = await page.evaluate(() => {
      const iframe = document.querySelector(
        '[data-testid="display-preview-frame"]',
      ) as HTMLIFrameElement | null;
      const list = iframe?.contentDocument?.querySelector(
        '[data-testid="display-by-person"]',
      );
      return list ? getComputedStyle(list).gridTemplateColumns : "";
    });

    await page.setViewportSize({ width: 1600, height: 900 });
    const innerAfter = await page.evaluate(() => {
      const iframe = document.querySelector(
        '[data-testid="display-preview-frame"]',
      ) as HTMLIFrameElement | null;
      const win = iframe?.contentWindow;
      if (!win) return null;
      return { width: win.innerWidth, height: win.innerHeight };
    });
    expect(innerAfter).toEqual({ width: 3840, height: 2160 });
    const columnsAfter = await page.evaluate(() => {
      const iframe = document.querySelector(
        '[data-testid="display-preview-frame"]',
      ) as HTMLIFrameElement | null;
      const list = iframe?.contentDocument?.querySelector(
        '[data-testid="display-by-person"]',
      );
      return list ? getComputedStyle(list).gridTemplateColumns : "";
    });
    expect(columnsAfter).toBe(columnsBefore);
    await expect(page.getByTestId("display-preview-geometry")).toContainText("fit");

    await page.getByRole("button", { name: "1920 × 1080" }).click();
    await expect(page.getByTestId("display-preview-geometry")).toContainText("1920 × 1080");
    await expect(frame).toHaveAttribute("width", "1920");

    await page.getByTestId("display-preview-width").fill("100");
    await page.getByTestId("display-preview-height").fill("100");
    await page.getByRole("button", { name: "Apply size" }).click();
    await expect(page.getByTestId("display-preview-viewport-error")).toBeVisible();
  });
});
