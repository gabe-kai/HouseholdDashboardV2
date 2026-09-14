import type { Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Write a full-page screenshot with retries (Windows file locks on overwritten report PNGs). */
export async function durableScreenshot(page: Page, destPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tempPath = path.join(
    os.tmpdir(),
    `hd-shot-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`,
  );
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await page.screenshot({ path: tempPath, fullPage: true });
      fs.copyFileSync(tempPath, destPath);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    } finally {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
