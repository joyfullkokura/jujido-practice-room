// 画面のスクリーンショットを撮る: node scripts/screenshot.mjs [URL] [保存先フォルダ] [時刻(例 2026-11-27T15:20:00+09:00)]
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "screenshots";
const fakeTime = process.argv[4]; // 現在時刻の赤線などを確認したいときに時刻を固定する
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const targets = [
  { name: "mobile", ctx: { ...devices["iPhone 13"], defaultBrowserType: undefined } },
  { name: "pc", ctx: { viewport: { width: 1366, height: 900 } } },
];
for (const t of targets) {
  const ctx = await browser.newContext({ ...t.ctx, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  if (fakeTime) await page.clock.setFixedTime(new Date(fakeTime));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${t.name}-1-calendar.png`, fullPage: t.name === "pc" });
  const free = page.locator('button[aria-label$="空き"]').first();
  if (await free.count()) {
    await free.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${t.name}-2-sheet.png` });
  }
  await ctx.close();
}
await browser.close();
console.log("saved to", out);
