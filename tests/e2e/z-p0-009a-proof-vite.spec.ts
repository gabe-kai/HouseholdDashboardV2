import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test.describe("P0-009A family-board proof (Vite only)", () => {
  test("AT8a/AT8b/AT9a/AT10/AT12a/AT13: proof stays local and exercises concept interactions", async ({
    page,
  }, testInfo) => {
    expect(testInfo.project.name === "vite-desktop" || testInfo.project.name === "vite-touch").toBe(
      true,
    );
    const requests: string[] = [];
    page.on("request", (request) => {
      requests.push(request.url());
    });
    await page.goto("/family-board-proof.html");
    await expect(page.getByTestId("family-board-proof")).toBeVisible();
    await expect(page.getByTestId("family-board-meta")).toContainText(
      "p0-009a-family-board-crowded-r2",
    );
    expect(requests.some((url) => url.includes("/api/v1/"))).toBeFalsy();

    const frame = page.frameLocator('[data-testid="family-board-frame"]');
    await page.getByTestId("proof-layout-current").click();
    await expect(frame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("proof-layout-concept").click();
    await expect(frame.getByTestId("family-board-concept")).toBeVisible();
    await expect(frame.getByTestId("family-pane-p-morgan")).toBeVisible();
    await expect(frame.getByTestId("family-pane-p-rowan")).toBeVisible();
    await expect(
      frame.getByText("Pack the unusually long backpack checklist", { exact: false }).first(),
    ).toBeVisible();

    await frame.getByRole("button", { name: "Coming up" }).first().click();
    await expect(frame.getByTestId("family-upcoming-p-morgan")).toBeVisible();
    await expect(frame.getByText("Homework time").first()).toBeVisible();
    await expect(frame.getByText("House cleaning").first()).toBeVisible();
    await expect(frame.getByText("Dinner cleanup").first()).toBeVisible();
    await expect(frame.getByText("Bedtime").first()).toBeVisible();
    await expect(frame.getByText("Cat litter").first()).toBeVisible();
    await frame.getByRole("button", { name: "Back to next task" }).first().click();

    const step = frame.getByTestId("family-done-w-morning-morgan-s3");
    await expect(step).toBeVisible();
    await step.click();
    await expect(frame.getByTestId("family-step-w-morning-morgan-s3")).toContainText("Done");

    await page.getByTestId("proof-scenario-states").click();
    await expect(frame.getByText("Required done, optional left").first()).toBeVisible();
    await expect(frame.getByText("Unresolved as needed").first()).toBeVisible();
    await expect(frame.getByText("Anytime drawer tidy").first()).toBeVisible();

    await page.getByTestId("proof-scenario-family").click();
    await expect(frame.getByTestId("family-day-p-morgan")).toBeVisible();
    await expect(frame.getByText("School — fictional").first()).toBeVisible();
    await expect(frame.getByText("Meals — fictional").first()).toBeVisible();

    const shotDir = path.join("reports", "_local-screenshots", "p0-009a-r2");
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({
      path: path.join(shotDir, `${testInfo.project.name}-concept.png`),
      fullPage: true,
    });
  });

  test("AT11/AT12b/AT14: enlarge, idle clock, and touch-safe targets", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "vite-touch" && testInfo.project.name !== "vite-desktop",
      "Proof desktop/touch projects only",
    );
    await page.goto("/family-board-proof.html?layout=concept");
    const frame = page.frameLocator('[data-testid="family-board-frame"]');
    await expect(frame.getByTestId("family-board-concept")).toBeVisible();
    const enlargeSize = await page.locator('[data-testid="family-board-frame"]').evaluate((node) => {
      const iframe = node as HTMLIFrameElement;
      const button = iframe.contentDocument?.querySelector('[data-testid="family-enlarge-p-morgan"]');
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(enlargeSize).toBeTruthy();
    expect(enlargeSize!.height).toBeGreaterThanOrEqual(48);
    expect(enlargeSize!.width).toBeGreaterThanOrEqual(48);
    await frame.getByTestId("family-enlarge-p-morgan").click();
    await expect(frame.getByTestId("family-back-p-morgan")).toBeVisible();
    await frame.getByTestId("family-back-p-morgan").click();
    await expect(frame.getByTestId("family-enlarge-p-morgan")).toBeVisible();

    const proofFrame = page.frame({ url: /surface=board/ });
    expect(proofFrame).toBeTruthy();
    await proofFrame!.evaluate(() => {
      window.__HD_PROOF_CLOCK_MS = 0;
    });
    await expect(frame.getByTestId("family-board-concept")).toHaveAttribute("data-clock", "0");
    await frame.getByRole("button", { name: "Coming up" }).first().click();
    await frame.getByRole("button", { name: "Coming up" }).nth(1).click();
    await expect(frame.getByTestId("family-upcoming-p-morgan")).toBeVisible();
    await expect(frame.getByTestId("family-upcoming-p-avery")).toBeVisible();
    await proofFrame!.evaluate(() => {
      window.__HD_PROOF_CLOCK_MS = 10_000;
    });
    await expect(frame.getByTestId("family-board-concept")).toHaveAttribute("data-clock", "10000");
    await frame.getByRole("button", { name: "Coming up" }).first().click();
    await proofFrame!.evaluate(() => {
      window.__HD_PROOF_CLOCK_MS = 90_001;
    });
    await expect(frame.getByTestId("family-board-concept")).toHaveAttribute("data-clock", "90001");
    await expect(frame.getByTestId("family-upcoming-p-morgan")).toBeVisible();
    await expect(frame.getByTestId("family-upcoming-p-avery")).toHaveCount(0);
  });
});
