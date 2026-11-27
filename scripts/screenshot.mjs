// 一般の予約画面のスクリーンショットを撮る
//   node scripts/screenshot.mjs [URL] [保存先フォルダ] [時刻(例 2026-11-27T15:20:00+09:00)] [--mock]
// --mock を付けると Supabase へは行かず、下のサンプルデータで表示する（見た目の確認用）
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const mock = args.includes("--mock");
const [url = "http://localhost:3000", out = "screenshots", fakeTime] = args.filter((a) => a !== "--mock");
mkdirSync(out, { recursive: true });

const R = (id, name, instruments, capacity = 4) => ({ id, name, color: "#6b6b6b", capacity, description: null, sort_order: id, instruments });
const MOCK_ROOMS = [
  R(1, "L-1", "アップライトピアノ"), R(2, "M-3", "グランドピアノ、ステージア ELS-01C"),
  R(3, "L-2", "アップライトピアノ、ステージア ELS-02C、ELS-03X"), R(4, "S-5", "グランドピアノ"),
  R(5, "M-2", "グランドピアノ"), R(6, "M-1", "アップライトピアノ、ステージア ELS-02C"),
  R(7, "S-6", "グランドピアノ、アップライトピアノ"), R(8, "ホール", "グランドピアノ", 30),
];
const t = (date, hm) => `${date}T${hm}:00+09:00`;
const mockSlots = (date) => [
  { room_id: 1, start_at: t(date, "11:00"), end_at: t(date, "12:30") },
  { room_id: 1, start_at: t(date, "17:15"), end_at: t(date, "18:45") },
  { room_id: 2, start_at: t(date, "13:00"), end_at: t(date, "16:00") },
  { room_id: 3, start_at: t(date, "16:00"), end_at: t(date, "17:00") },
  { room_id: 4, start_at: t(date, "18:00"), end_at: t(date, "18:30") },
  { room_id: 5, start_at: t(date, "10:00"), end_at: t(date, "12:00"), is_maint: true },
  { room_id: 8, start_at: t(date, "19:00"), end_at: t(date, "21:00") },
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
    await page.route(/\/rest\/v1\/closures/, (r) => r.fulfill({ json: [] }));
    await page.route(/\/rest\/v1\/business_hours/, (r) => r.fulfill({ json: [] }));
    await page.route(/\/rest\/v1\/rpc\/public_quote/, (r) => {
      const b = r.request().postDataJSON(), h = (Date.parse(b.p_end_at) - Date.parse(b.p_start_at)) / 3600e3;
      r.fulfill({ json: Math.round(1100 * h) });
    });
  }
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${tg.name}-1-day.png`, fullPage: true });
  // 空いている所をタップ（今の時刻の少し後）
  const track = page.locator('[data-track="4"]');
  const box = await track.boundingBox();
  const sl = await page.locator("[data-timeline]").evaluate((el) => el.scrollLeft);
  await page.mouse.click(box.x + sl + 140 + 10, box.y + box.height / 2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${tg.name}-2-sheet.png` });
  await ctx.close();
}
await browser.close();
console.log("saved to", out);
