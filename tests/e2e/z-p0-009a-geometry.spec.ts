import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
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

  test("AT7a: fitted preview typography matches a native wall at 3840 and 1920", async ({
    page,
    browser,
  }) => {
    await ensureManagerSession(page.request);
    const origin = requestOrigin();
    const session = await page.request.get("/api/v1/auth/session");
    const csrfToken = ((await session.json()) as { csrfToken: string }).csrfToken;
    const create = await page.request.post("/api/v1/displays", {
      headers: { "x-csrf-token": csrfToken, Origin: origin },
      data: { mutationId: crypto.randomUUID(), label: `Native ${Date.now().toString(36)}` },
    });
    expect(create.ok(), await create.text()).toBeTruthy();
    const created = (await create.json()) as {
      display: { id: string };
      enrollment: { code: string };
    };

    const wallCtx = await browser.newContext({
      viewport: { width: 3840, height: 2160 },
      deviceScaleFactor: 1,
    });
    const wall = await wallCtx.newPage();
    await wall.goto("/display");
    await wall.getByTestId("display-claim-code").fill(created.enrollment.code);
    await wall.getByRole("button", { name: "Connect display" }).click();
    await expect(wall.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });

    await page.goto(`/household/displays/${created.display.id}/preview`);
    await expect(page.getByTestId("display-preview-host")).toBeVisible();
    const previewFrame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(previewFrame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });

    async function measure(target: Page, iframe: boolean) {
      return target.evaluate((useIframe) => {
        const win = useIframe
          ? (document.querySelector('[data-testid="display-preview-frame"]') as HTMLIFrameElement | null)
              ?.contentWindow
          : window;
        const doc = useIframe
          ? (document.querySelector('[data-testid="display-preview-frame"]') as HTMLIFrameElement | null)
              ?.contentDocument
          : document;
        if (!win || !doc) return null;
        const name = doc.querySelector(".display-person-name, .display-time");
        const list = doc.querySelector('[data-testid="display-by-person"]');
        return {
          innerWidth: win.innerWidth,
          innerHeight: win.innerHeight,
          fontSize: name ? getComputedStyle(name).fontSize : "",
          columns: list ? getComputedStyle(list).gridTemplateColumns : "",
          mq1920: win.matchMedia("(min-width: 1920px)").matches,
          mq3000: win.matchMedia("(min-width: 3000px)").matches,
        };
      }, iframe);
    }

    const nativeUhd = await measure(wall, false);
    const previewUhd = await measure(page, true);
    expect(nativeUhd).toBeTruthy();
    expect(previewUhd).toBeTruthy();
    expect(previewUhd!.innerWidth).toBe(3840);
    expect(previewUhd!.innerHeight).toBe(2160);
    expect(previewUhd!.fontSize).toBe(nativeUhd!.fontSize);
    expect(previewUhd!.mq1920).toBe(nativeUhd!.mq1920);
    expect(previewUhd!.mq3000).toBe(nativeUhd!.mq3000);
    expect(previewUhd!.columns).toBe(nativeUhd!.columns);

    await page.setViewportSize({ width: 1280, height: 800 });
    const previewAt1280 = await measure(page, true);
    expect(previewAt1280).toEqual(previewUhd);
    const scaleAt1280 = await page.getByTestId("display-preview-geometry").innerText();
    await page.setViewportSize({ width: 1600, height: 1000 });
    const previewAfterWiden = await measure(page, true);
    expect(previewAfterWiden).toEqual(previewUhd);
    await page.setViewportSize({ width: 720, height: 800 });
    await expect
      .poll(async () => page.getByTestId("display-preview-geometry").innerText())
      .not.toBe(scaleAt1280);
    expect(await measure(page, true)).toEqual(previewUhd);

    await page.getByRole("button", { name: "1920 × 1080" }).click();
    await wall.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.getByTestId("display-preview-geometry")).toContainText("1920 × 1080");
    const nativeFhd = await measure(wall, false);
    const previewFhd = await measure(page, true);
    expect(previewFhd!.innerWidth).toBe(1920);
    expect(previewFhd!.innerHeight).toBe(1080);
    expect(previewFhd!.fontSize).toBe(nativeFhd!.fontSize);
    expect(previewFhd!.mq1920).toBe(nativeFhd!.mq1920);
    expect(previewFhd!.mq3000).toBe(false);
    await wallCtx.close();
  });
});
