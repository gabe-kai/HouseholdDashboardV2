import type { CDPSession, Page } from "@playwright/test";

/**
 * Chromium CDP touch input — distinct from mouse/pointer Playwright drag helpers.
 * OrderedList listens for Pointer Events; Chromium synthesizes those from touch.
 */
export async function touchDragByCdp(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options?: { steps?: number; pauseMs?: number },
): Promise<CDPSession> {
  const steps = options?.steps ?? 16;
  const pauseMs = options?.pauseMs ?? 20;
  const client = await page.context().newCDPSession(page);

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          id: 1,
        },
      ],
    });
    if (pauseMs > 0) await page.waitForTimeout(pauseMs);
  }

  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });

  return client;
}

export async function touchDragCancelByEscape(
  page: Page,
  from: { x: number; y: number },
  mid: { x: number; y: number },
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: mid.x, y: mid.y, id: 1 }],
  });
  await page.waitForTimeout(40);
  await page.keyboard.press("Escape");
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}
