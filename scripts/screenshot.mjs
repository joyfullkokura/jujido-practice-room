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
  { id: 3, name: "3階 スタジオ", color: "#7a7a52", capacity: 8, description: null, sort_order: 3 },
];
const t = (date, hm) => `${date}T${hm}:00+09:00`;
const mockSlots = (date) => [
  { room_id: 1, start_at: t(date, "11:00"), end_at: t(date, "12:30") },
  { room_id: 1, start_at: t(date, "17:15"), end_at: t(date, "18:45") },
  { room_id: 2, start_at: t(date, "13:00"), end_at: t(date, "16:00") },
  { room_id: 2, start_at: t(date, "18:00"), end_at: t(date, "18:30") },
  { room_id: 3, start_at: t(date, "19:00"), end_at: t(date, "21:00") },
];

const browser = await chromium.launch();
const targets = [
  { name: "mobile", ctx: { ...devices["iPhone 13"], defaultBrowserType: undefined } },
  { name: "pc", ctx: { viewport: { width: 1366, height: 900 } } },
];
for (const tg of targets) {
  const ctx = await browser.newContext({ ...tg.ctx, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  if (fakeTime) await page.clock.setFixedTime(new Date(fakeTime));
  if (mock) {
    const today = (fakeTime ? new Date(fakeTime) : new Date()).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    await page.route(/\/rest\/v1\/rooms/, (r) => r.fulfill({ json: MOCK_ROOMS }));
    await page.route(/\/rest\/v1\/booked_slots/, (r) => r.fulfill({ json: mockSlots(today) }));
  }
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${tg.name}-1-day.png`, fullPage: tg.name === "pc" });
  const free = page.locator('button[aria-label$="空き"]').nth(4);
  if (await free.count()) {
    await free.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${tg.name}-2-sheet.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  const weekBtn = page.getByRole("button", { name: "週", exact: true });
  if (await weekBtn.count()) {
    await weekBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${tg.name}-3-week.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log("saved to", out);
