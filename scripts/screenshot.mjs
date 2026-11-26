// 画面のスクリーンショットを撮る
//   node scripts/screenshot.mjs [URL] [保存先フォルダ] [時刻(例 2026-11-27T15:20:00+09:00)] [--mock]
// --mock を付けると Supabase へは行かず、下のサンプルデータで表示する（見た目の確認用）
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const mock = args.includes("--mock");
const [url = "http://localhost:3000", out = "screenshots", fakeTime] = args.filter((a) => a !== "--mock");
mkdirSync(out, { recursive: true });

const MOCK_ROOMS = [
  { id: 1, name: "2階 練習室A", color: "#4f7a87", capacity: 5, description: "ドラムセット・ギターアンプ2台", sort_order: 1 },
  { id: 2, name: "2階 練習室B", color: "#8a6474", capacity: 3, description: "電子ピアノ・ボーカル練習向け", sort_order: 2 },
];
const mockSlots = (date) => [
  ...[11, 12].map((h) => ({ room_id: 1, date, start_hour: h, group_id: "g1" })),
  ...[17].map((h) => ({ room_id: 1, date, start_hour: h, group_id: "g2" })),
  ...[13, 14, 15].map((h) => ({ room_id: 2, date, start_hour: h, group_id: "g3" })),
];

const browser = await chromium.launch();
const targets = [
  { name: "mobile", ctx: { ...devices["iPhone 13"], defaultBrowserType: undefined } },
  { name: "pc", ctx: { viewport: { width: 1366, height: 900 } } },
];
for (const t of targets) {
  const ctx = await browser.newContext({ ...t.ctx, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  if (fakeTime) await page.clock.setFixedTime(new Date(fakeTime));
  if (mock) {
    const today = (fakeTime ? new Date(fakeTime) : new Date()).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    await page.route(/\/rest\/v1\/rooms/, (r) => r.fulfill({ json: MOCK_ROOMS }));
    await page.route(/\/rest\/v1\/booked_slots/, (r) => r.fulfill({ json: mockSlots(today) }));
  }
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
