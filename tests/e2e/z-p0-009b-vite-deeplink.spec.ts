import { expect, test, type APIRequestContext } from "@playwright/test";

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

test.describe("P0-009B Vite preview destination", () => {
  test("AT18c Vite: selected-display preview reloads the family board", async ({ page }) => {
    await ensureManagerSession(page.request);
    const created = await page.request.post("/api/v1/displays", {
      headers: {
        Origin: requestOrigin(),
        "x-csrf-token": (
          (await (await page.request.get("/api/v1/auth/session")).json()) as {
            csrfToken: string;
          }
        ).csrfToken,
      },
      data: { mutationId: crypto.randomUUID(), label: "Vite family wall" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const displayId = ((await created.json()) as { display: { id: string } }).display.id;
    await page.goto(`/household/displays/${displayId}/preview`);
    await expect(page.getByTestId("display-preview-host")).toBeVisible({ timeout: 20_000 });
    const frame = page.frameLocator("iframe").first();
    await expect(frame.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByTestId("display-preview-host")).toBeVisible({ timeout: 20_000 });
    const reloaded = page.frameLocator("iframe").first();
    await expect(reloaded.getByTestId("family-board")).toBeVisible({ timeout: 20_000 });
  });
});
