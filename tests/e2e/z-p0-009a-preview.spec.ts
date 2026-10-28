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
  expect(boot.status()).toBe(409);
  const login = await request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: { loginName: MANAGER_LOGIN, passphrase: PASSPHRASE },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
}

async function createPreviewDisplay(page: Page, label: string) {
  await ensureManagerSession(page.request);
  await page.goto("/household/displays");
  await expectSignedInAs(page, "Morgan Reed");
  await expect(page.getByTestId("household-displays")).toBeVisible();
  await page.getByTestId("display-label-input").fill(label);
  await page.getByRole("button", { name: "Add display" }).click();
  await expect(page.getByTestId("display-code-panel")).toBeVisible();
  const preview = page.getByRole("button", { name: "Preview display" }).first();
  await expect(preview).toBeVisible();
  return preview;
}

test.describe("P0-009A selected-display preview", () => {
  test("AT3b/AT6a/AT7b: preview opens read-only, restores by URL, and Back returns", async ({
    page,
  }) => {
    const label = `Preview ${Date.now().toString(36)}`;
    const previewButton = await createPreviewDisplay(page, label);
    await previewButton.click();
    await expect(page.getByTestId("display-preview-host")).toBeVisible();
    await expect(page.getByTestId("display-preview-only")).toContainText(
      "Preview only — changes cannot be made here",
    );
    await expect(page).toHaveURL(/\/household\/displays\/.+\/preview/);
    const frame = page.frameLocator('[data-testid="display-preview-frame"]');
    await expect(frame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByTestId("display-org-by-person")).toBeVisible();
    await frame.getByTestId("display-org-by-work").click();
    await expect(frame.getByTestId("display-by-work")).toBeVisible();
    await expect(frame.getByTestId("display-step-done-x")).toHaveCount(0);

    const previewUrl = page.url();
    await page.reload();
    await expect(page.getByTestId("display-preview-host")).toBeVisible();
    await expect(page).toHaveURL(previewUrl);

    await page.getByRole("button", { name: "Back to displays" }).click();
    await expect(page.getByTestId("household-displays")).toBeVisible();
    await expect(page).toHaveURL(/\/household\/displays$/);
  });

  test("AT6a signed-out restore: preview path is remembered through sign-in", async ({
    page,
    context,
  }) => {
    const label = `Restore ${Date.now().toString(36)}`;
    await createPreviewDisplay(page, label);
    await page.getByRole("button", { name: "Preview display" }).first().click();
    await expect(page.getByTestId("display-preview-host")).toBeVisible();
    const previewPath = new URL(page.url()).pathname;

    await context.clearCookies();
    await page.goto(previewPath);
    await page.getByLabel("Login name").fill(MANAGER_LOGIN);
    await page.getByLabel("Passphrase").fill(PASSPHRASE);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("display-preview-host")).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe(previewPath);
  });

  test("AT8b built absence: production client does not serve the proof entry", async ({
    request,
  }) => {
    const proof = await request.get("/family-board-proof.html");
    const body = await proof.text();
    expect(body).not.toContain("Family board proof");
    expect(body).not.toContain("p0-009a-family-board-crowded-r2");
    expect(body).not.toContain("family-board-proof.tsx");
    const distProof = "dist/client/family-board-proof.html";
    const { existsSync } = await import("node:fs");
    expect(existsSync(distProof)).toBe(false);
  });
});
