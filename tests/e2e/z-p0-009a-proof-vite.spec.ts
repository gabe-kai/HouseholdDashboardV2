import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function boardFrame(page: Page) {
  return page.frameLocator('[data-testid="family-board-frame"]');
}

function boardWindow(page: Page) {
  return page.frame({ url: /surface=board/ });
}

test.describe("P0-009A family-board proof (Vite only)", () => {
  test("AT8a/AT8b/AT9a/AT9b/AT13: comparison pair, crowded reachability, states, family day", async ({
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

    const frame = boardFrame(page);
    const shotDir = path.join("reports", "_local-screenshots", "p0-009a-r2");
    fs.mkdirSync(shotDir, { recursive: true });

    await page.getByTestId("proof-layout-current").click();
    await expect(frame.getByTestId("display-overview")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({
      path: path.join(shotDir, `${testInfo.project.name}-current.png`),
      fullPage: true,
    });

    await page.getByTestId("proof-layout-concept").click();
    await expect(frame.getByTestId("family-board-concept")).toBeVisible();
    const meta = await page.getByTestId("family-board-meta").innerText();

    for (const person of ["morgan", "avery", "jordan", "casey", "taylor", "rowan"]) {
      await expect(frame.getByTestId(`family-pane-p-${person}`)).toBeVisible();
    }
    await expect(
      frame.getByText("Pack the unusually long backpack checklist", { exact: false }).first(),
    ).toBeVisible();
    await expect(frame.getByTestId("family-unassigned")).toBeVisible();
    await expect(
      frame.getByTestId("family-unassigned").getByRole("button", { name: /claim/i }),
    ).toHaveCount(0);
    await expect(frame.getByTestId("family-promoted-view-only")).toBeVisible();

    const typeSizes = await page.locator('[data-testid="family-board-frame"]').evaluate((node) => {
      const iframe = node as HTMLIFrameElement;
      const name = iframe.contentDocument?.querySelector(".display-person-name");
      const work = iframe.contentDocument?.querySelector(".display-work-title");
      return {
        name: name ? getComputedStyle(name).fontSize : "",
        work: work ? getComputedStyle(work).fontSize : "",
      };
    });
    expect(Number.parseFloat(typeSizes.name)).toBeGreaterThan(0);
    expect(Number.parseFloat(typeSizes.work)).toBeGreaterThan(0);
    fs.writeFileSync(
      path.join(shotDir, `${testInfo.project.name}-comparison.json`),
      JSON.stringify(
        {
          fixture: "p0-009a-family-board-crowded-r2",
          scenario: "crowded",
          viewport: "3840x2160",
          browser: testInfo.project.name,
          dpr: testInfo.project.use.deviceScaleFactor ?? 1,
          scale: /fit (\d+)%/.exec(meta)?.[1] ?? null,
          typeSizes: { personName: typeSizes.name, workTitle: typeSizes.work },
          files: [
            `${testInfo.project.name}-current.png`,
            `${testInfo.project.name}-concept.png`,
          ],
        },
        null,
        2,
      ),
    );

    await frame.getByRole("button", { name: "Coming up" }).first().click();
    await expect(frame.getByTestId("family-upcoming-p-morgan")).toBeVisible();
    for (const heading of [
      "Homework time",
      "House cleaning",
      "Dinner cleanup",
      "Bedtime",
      "Cat litter",
    ]) {
      await expect(frame.getByText(heading).first()).toBeVisible();
    }
    await frame.getByRole("button", { name: "Earlier" }).first().click();
    await expect(frame.getByTestId("family-pane-p-morgan")).toHaveAttribute("data-section", "earlier");
    await frame.getByRole("button", { name: "Back to next task" }).first().click();
    await expect(frame.getByTestId("family-pane-p-morgan")).toHaveAttribute("data-section", "next");

    const boardScroll = await page.locator('[data-testid="family-board-frame"]').evaluate((node) => {
      const iframe = node as HTMLIFrameElement;
      const stage = iframe.contentDocument?.querySelector('[data-testid="family-board-concept"]');
      return stage?.scrollWidth && stage.clientWidth
        ? stage.scrollWidth <= stage.clientWidth + 1
        : false;
    });
    expect(boardScroll).toBe(true);

    await page.getByRole("button", { name: "1920 × 1080" }).click();
    await expect(page.getByTestId("family-board-meta")).toContainText("1920×1080");
    for (const person of ["morgan", "avery", "jordan", "casey", "taylor", "rowan"]) {
      await expect(frame.getByTestId(`family-pane-p-${person}`)).toBeVisible();
    }
    await page.getByRole("button", { name: "3840 × 2160" }).click();

    await page.screenshot({
      path: path.join(shotDir, `${testInfo.project.name}-concept.png`),
      fullPage: true,
    });

    await page.getByTestId("proof-scenario-states").click();
    await expect(frame.getByTestId("family-empty-p-morgan")).toBeVisible();
    await expect(frame.getByText("Required done, optional left").first()).toBeVisible();
    await expect(frame.getByText("Optional").first()).toBeVisible();
    await expect(frame.getByText("Unresolved as needed").first()).toBeVisible();
    await expect(frame.getByText("As needed").first()).toBeVisible();
    await expect(frame.getByText("Anytime drawer tidy").first()).toBeVisible();
    await expect(frame.getByTestId("family-unassigned")).toBeVisible();
    await expect(frame.getByTestId("family-promoted-view-only")).toBeVisible();

    await page.getByTestId("proof-fail-detail").click();
    await page.getByTestId("proof-layout-current").click();
    await expect(frame.getByTestId("display-overview")).toBeVisible();
    await frame.locator("button.display-work-row").first().click();
    await expect(frame.getByTestId("display-detail-unavailable")).toBeVisible();
    await expect(frame.getByTestId("display-detail-unavailable")).toContainText("Retry");

    await page.getByTestId("proof-layout-concept").click();
    await page.getByTestId("proof-scenario-family").click();
    await expect(frame.getByTestId("family-day-p-morgan")).toBeVisible();
    await expect(frame.getByTestId("family-school-p-avery")).toContainText("Science fair paragraph");
    await expect(frame.getByTestId("family-school-p-jordan")).toContainText("Spelling list");
    await expect(frame.getByTestId("family-meals-shared").first()).toContainText("pasta and salad");
    await expect(frame.getByTestId("family-calendar-p-morgan")).toContainText("Early release Friday 2026-10-30");
    await expect(frame.getByTestId("family-calendar-p-morgan")).toContainText("Avery and Jordan");
    await expect(frame.getByTestId("family-calendar-p-morgan")).toContainText("Today vs Later");
    await frame.getByRole("button", { name: "Coming up" }).first().click();
    await expect(frame.getByText("Homework time").first()).toBeVisible();
    await frame.getByTestId("family-done-hw-m-1").click();
    await expect(frame.getByTestId("family-step-hw-m-1")).toContainText("Done");
    await expect(frame.getByTestId("family-school-p-avery")).toBeVisible();
    expect(requests.some((url) => url.includes("/api/v1/"))).toBeFalsy();
  });

  test("AT10/AT11/AT12a/AT12b/AT14a: independent panes, enlarge, simulated actions, a11y", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "vite-touch" && testInfo.project.name !== "vite-desktop",
      "Proof desktop/touch projects only",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/family-board-proof.html?layout=concept");
    const frame = boardFrame(page);
    await expect(frame.getByTestId("family-board-concept")).toBeVisible();

    const morganScroll = frame.getByTestId("family-scroll-p-morgan");
    const averyScroll = frame.getByTestId("family-scroll-p-avery");
    await frame.getByRole("button", { name: "Coming up" }).first().click();
    await expect(frame.getByTestId("family-pane-p-morgan")).toHaveAttribute("data-section", "upcoming");
    await expect(frame.getByTestId("family-scroll-spacer-p-morgan")).toBeVisible();
    await expect
      .poll(async () => morganScroll.evaluate((node) => node.scrollHeight - node.clientHeight))
      .toBeGreaterThan(120);
    await morganScroll.evaluate((node) => {
      node.scrollTop = 120;
      node.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(async () => morganScroll.evaluate((node) => node.scrollTop)).toBe(120);
    await frame.getByRole("button", { name: "Earlier" }).nth(1).click();
    await expect(frame.getByTestId("family-pane-p-avery")).toHaveAttribute("data-section", "earlier");
    await expect(frame.getByTestId("family-scroll-spacer-p-avery")).toBeVisible();
    await expect
      .poll(async () => averyScroll.evaluate((node) => node.scrollHeight - node.clientHeight))
      .toBeGreaterThan(80);
    await averyScroll.evaluate((node) => {
      node.scrollTop = 80;
      node.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(async () => averyScroll.evaluate((node) => node.scrollTop)).toBe(80);
    await frame.getByRole("button", { name: "More sections" }).first().click();
    await expect(frame.getByTestId("family-pane-p-morgan")).toHaveAttribute("data-section", "more");
    expect(await frame.getByTestId("family-pane-p-avery").getAttribute("data-section")).toBe("earlier");
    await expect.poll(async () => averyScroll.evaluate((node) => node.scrollTop)).toBe(80);
    await frame.getByRole("button", { name: "Back to next task" }).first().click();
    await expect(frame.getByTestId("family-pane-p-morgan")).toHaveAttribute("data-section", "next");

    await frame.getByRole("button", { name: "Coming up" }).first().click();
    await expect(frame.getByTestId("family-scroll-spacer-p-morgan")).toBeVisible();
    await expect
      .poll(async () => morganScroll.evaluate((node) => node.scrollHeight - node.clientHeight))
      .toBeGreaterThan(40);
    await morganScroll.evaluate((node) => {
      node.scrollTop = 40;
      node.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(async () => morganScroll.evaluate((node) => node.scrollTop)).toBe(40);
    await frame.getByTestId("family-enlarge-p-morgan").press("Enter");
    await expect(frame.getByTestId("family-back-p-morgan")).toBeVisible();
    await expect(frame.getByTestId("family-pane-p-morgan")).toContainText("Morgan Reed");
    await frame.getByTestId("family-back-p-morgan").click();
    await expect(frame.getByTestId("family-enlarge-p-morgan")).toBeFocused();
    const restored = await morganScroll.evaluate((node) => node.scrollTop);
    expect(restored).toBe(40);
    await frame.getByRole("button", { name: "Back to next task" }).first().click();
    await expect(frame.getByTestId("family-pane-p-morgan")).toHaveAttribute("data-section", "next");
    await expect(frame.getByTestId("family-done-w-morning-morgan-s3")).toBeVisible();

    const boxBefore = await page.locator('[data-testid="family-board-frame"]').evaluate((node) => {
      const iframe = node as HTMLIFrameElement;
      const done = iframe.contentDocument?.querySelector('[data-testid="family-done-w-morning-morgan-s3"]');
      const enlarge = iframe.contentDocument?.querySelector('[data-testid="family-enlarge-p-morgan"]');
      return {
        done: done ? (done as HTMLElement).innerText : "",
        enlarge: enlarge ? enlarge.getBoundingClientRect() : null,
      };
    });
    const paneBox = await frame.getByTestId("family-scroll-p-morgan").boundingBox();
    expect(paneBox).toBeTruthy();
    await page.mouse.move(paneBox!.x + 20, paneBox!.y + 20);
    await page.mouse.down();
    await page.mouse.move(paneBox!.x + 80, paneBox!.y + 80);
    await page.mouse.up();
    await expect(frame.getByTestId("family-enlarge-p-morgan")).toBeVisible();
    await expect(frame.getByTestId("family-done-w-morning-morgan-s3")).toHaveText(boxBefore.done || /Done/);

    const step = frame.getByTestId("family-done-w-morning-morgan-s3");
    await step.click();
    await expect(frame.getByTestId("family-step-w-morning-morgan-s3")).toContainText("Done");
    await frame.getByTestId("family-done-w-morning-morgan-s3").click();
    await expect(frame.getByTestId("family-step-w-morning-morgan-s3")).toContainText("Open");

    await frame.getByTestId("family-pane-p-rowan").getByRole("button", { name: "Coming up" }).click();
    await expect(frame.getByTestId("family-not-needed-cats-2")).toBeVisible();
    await frame.getByTestId("family-not-needed-cats-2").click();
    await expect(frame.getByTestId("family-step-cats-2")).toContainText("Not needed");

    await page.getByTestId("proof-hold").click();
    await expect(frame.getByTestId("family-board-concept")).toBeVisible();
    await frame.getByTestId("family-done-w-morning-morgan-s4").click();
    await expect(frame.getByText("Saving…").first()).toBeVisible();
    const settleFrame = boardWindow(page);
    expect(settleFrame).toBeTruthy();
    await settleFrame!.evaluate(() => {
      window.__HD_PROOF_SETTLE__ = true;
    });
    await expect(frame.getByTestId("family-step-w-morning-morgan-s4")).toContainText("Done");
    await page.getByTestId("proof-hold").click();
    await expect(frame.getByTestId("family-board-concept")).toBeVisible();
    await frame.getByTestId("family-done-w-morning-morgan-s5").click();
    await expect(frame.getByText("Saving…").first()).toBeVisible();
    const rejectFrame = boardWindow(page);
    await rejectFrame!.evaluate(() => {
      window.__HD_PROOF_REJECT__ = true;
    });
    await expect(frame.getByTestId("family-error-w-morning-morgan")).toBeVisible();

    const hits = await page.locator('[data-testid="family-board-frame"]').evaluate((node) => {
      const iframe = node as HTMLIFrameElement;
      const view = iframe.contentWindow;
      const buttons = [
        ...Array.from(iframe.contentDocument?.querySelectorAll(".family-board-hit") ?? []),
      ];
      const viewW = view?.innerWidth ?? 0;
      const viewH = view?.innerHeight ?? 0;
      const rects = buttons
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        })
        .filter((rect) => rect.x + rect.w > 0 && rect.y + rect.h > 0 && rect.x < viewW && rect.y < viewH);
      const tooSmall = rects.filter((rect) => rect.w < 48 || rect.h < 48);
      let overlap = 0;
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]!;
          const b = rects[j]!;
          const separates =
            a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          if (!separates) overlap += 1;
        }
      }
      const reduced = iframe.contentWindow?.matchMedia("(prefers-reduced-motion: reduce)").matches;
      return { count: rects.length, tooSmall: tooSmall.length, overlap, reduced };
    });
    expect(hits.count).toBeGreaterThan(0);
    expect(hits.tooSmall).toBe(0);
    expect(hits.overlap).toBe(0);
    expect(hits.reduced).toBe(true);

    const proofFrame = boardWindow(page);
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
