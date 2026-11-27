// 画面の動作テスト（ドラッグ選択・時刻リストの絞り込み）。サンプルデータを使い、DB には触れない
//   npm run dev を起動した状態で: node scripts/test-ui.mjs [URL]
import { chromium, devices } from "playwright";
import { openAdmin } from "./mock-admin.mjs";

const url = process.argv[2] ?? "http://localhost:3000";
const DAY = "2026-11-27";
const NOW = `${DAY}T09:00:00+09:00`; // 開店前に固定（過ぎた枠がない状態でテスト）
const ROOMS = [
  { id: 1, name: "2階 練習室A", color: "#4f7a87", capacity: 5, description: null, sort_order: 1 },
  { id: 2, name: "2階 練習室B", color: "#8a6474", capacity: 3, description: null, sort_order: 2 },
];
const t = (hm) => `${DAY}T${hm}:00+09:00`;
// 部屋A: 11:00-12:30 と 17:15-18:45 が予約済 ／ 部屋B: 13:00-16:00
const SLOTS = [
  { room_id: 1, start_at: t("11:00"), end_at: t("12:30") },
  { room_id: 1, start_at: t("17:15"), end_at: t("18:45") },
  { room_id: 2, start_at: t("13:00"), end_at: t("16:00") },
];
// 予約不可枠: 全部屋 20:00-21:00「店の都合」、営業時間は既定（10:00-21:00）
const CLOSURES = [{ id: 1, room_id: null, start_at: t("20:00"), end_at: t("21:00"), reason: "店の都合" }];

let ok = 0, ng = 0;
const check = (label, pass, detail = "") => { pass ? ok++ : ng++; console.log(`${pass ? "✅" : "❌"} ${label}${detail ? `  (${detail})` : ""}`); };
const hm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const M = (s) => { const [a, b] = s.split(":").map(Number); return a * 60 + b; };

const browser = await chromium.launch();
async function open(ctxOpts) {
  const ctx = await browser.newContext({ ...ctxOpts, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await page.route(/\/rest\/v1\/rooms/, (r) => r.fulfill({ json: ROOMS }));
  await page.route(/\/rest\/v1\/booked_slots/, (r) => r.fulfill({ json: SLOTS }));
  await page.route(/\/rest\/v1\/closures/, (r) => r.fulfill({ json: CLOSURES }));
  await page.route(/\/rest\/v1\/business_hours/, (r) => r.fulfill({ json: [] }));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { ctx, page };
}
const cell = (page, room, time) => page.locator(`button[data-col="r${room}"][data-m="${M(time)}"]`);
const center = async (page, room, time) => {
  await cell(page, room, time).scrollIntoViewIfNeeded();
  const b = await cell(page, room, time).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const sheetTimes = async (page) => ({
  start: hm(Number(await page.getByLabel("開始時刻").inputValue())),
  end: hm(Number(await page.getByLabel("終了時刻").inputValue())),
});
const enabledOptions = async (page, label) =>
  (await page.getByLabel(label).locator("option:not([disabled])").evaluateAll((os) => os.map((o) => Number(o.value))))
    .map(hm).join(",");
const closeSheet = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(350); };

// ───────── PC（マウス） ─────────
{
  const { ctx, page } = await open({ viewport: { width: 1366, height: 900 } });

  console.log("--- PC：ドラッグで範囲選択");
  async function mouseDrag(room, from, to, { hold } = {}) {
    const a = await center(page, room, from), b = await center(page, room, to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(a.x, a.y + ((b.y - a.y) * i) / 6);
    const preview = await page.getByTestId("drag-preview").textContent().catch(() => null);
    if (hold) await hold();
    await page.mouse.up();
    await page.waitForTimeout(350);
    return preview;
  }
  let pv = await mouseDrag(1, "13:00", "14:45");
  let s = await sheetTimes(page);
  check("13:00 から 14:45 の枠までなぞる → 13:00〜15:00", s.start === "13:00" && s.end === "15:00", `${s.start}〜${s.end}`);
  check("ドラッグ中にプレビューが出る", !!pv && pv.includes("13:00–15:00"), pv ?? "なし");
  await closeSheet(page);

  await mouseDrag(1, "16:00", "18:30");
  s = await sheetTimes(page);
  check("次の予約(17:15)にかかる 16:00→18:30 は 17:15 で止まる", s.start === "16:00" && s.end === "17:15", `${s.start}〜${s.end}`);
  await closeSheet(page);

  await mouseDrag(1, "12:30", "16:45");
  s = await sheetTimes(page);
  check("3時間を超える 12:30→16:45 は 12:30〜15:30 に縮む", s.start === "12:30" && s.end === "15:30", `${s.start}〜${s.end}`);
  await closeSheet(page);

  await mouseDrag(1, "16:00", "11:30");
  s = await sheetTimes(page);
  check("上向き 16:00→11:30 は 予約(〜12:30)と3時間制限で 13:15〜16:15", s.start === "13:15" && s.end === "16:15", `${s.start}〜${s.end}`);
  await closeSheet(page);

  await mouseDrag(2, "16:15", "21:00".replace("21:00", "20:45"));
  s = await sheetTimes(page);
  check("予約不可枠(20:00〜)にかかる 16:15→20:45 は 16:15〜19:15（3時間）", s.start === "16:15" && s.end === "19:15", `${s.start}〜${s.end}`);
  await closeSheet(page);

  await mouseDrag(1, "16:45", "16:45");
  s = await sheetTimes(page);
  check("押して動かさずに離す（=クリック）→ 1時間取れないので 16:45〜17:15 に縮む", s.start === "16:45" && s.end === "17:15", `${s.start}〜${s.end}`);
  await closeSheet(page);

  await cell(page, 1, "12:45").click();
  await page.waitForTimeout(300);
  s = await sheetTimes(page);
  check("クリックだけなら1時間 12:45〜13:45", s.start === "12:45" && s.end === "13:45", `${s.start}〜${s.end}`);

  console.log("--- PC：時刻リストの絞り込み");
  check("開始リスト：予約済(11:00〜12:15)と30分取れない10:45・19:45は選べない",
    !(await enabledOptions(page, "開始時刻")).split(",").some((x) => ["10:45", "11:00", "11:30", "12:15", "17:15", "18:30", "19:45", "20:00"].includes(x)),
    "");
  await page.getByLabel("開始時刻").selectOption(String(M("13:00")));
  await page.waitForTimeout(150);
  s = await sheetTimes(page);
  check("開始を 13:00 に変える → 長さ1時間を保って 13:00〜14:00", s.start === "13:00" && s.end === "14:00", `${s.start}〜${s.end}`);
  let ends = await enabledOptions(page, "終了時刻");
  check("終了リストは 13:30〜16:00（30分後〜3時間後）だけ選べる",
    ends === "13:30,13:45,14:00,14:15,14:30,14:45,15:00,15:15,15:30,15:45,16:00", ends);
  await page.getByLabel("終了時刻").selectOption(String(M("16:00")));
  await page.getByLabel("開始時刻").selectOption(String(M("16:30")));
  await page.waitForTimeout(150);
  s = await sheetTimes(page);
  ends = await enabledOptions(page, "終了時刻");
  check("開始を 16:30 に変える → 終了は次の予約の直前 17:15 に自動で縮む", s.end === "17:15", `${s.start}〜${s.end}`);
  check("終了リストは 17:00, 17:15 だけ選べる", ends === "17:00,17:15", ends);
  const disabled18 = await page.getByLabel("終了時刻").locator(`option[value="${M("18:00")}"]`).getAttribute("disabled");
  check("選べない終了時刻(18:00)は disabled（グレー）", disabled18 !== null);
  await page.getByRole("button", { name: "開始を15分遅く" }).click();
  s = await sheetTimes(page);
  check("＋ で開始 16:45、終了は 17:15 のまま（30分）", s.start === "16:45" && s.end === "17:15", `${s.start}〜${s.end}`);
  check("さらに ＋ は押せない（30分取れない）", await page.getByRole("button", { name: "開始を15分遅く" }).isDisabled());
  await closeSheet(page);

  const closedCell = await cell(page, 1, "20:15").isDisabled();
  check("予約不可枠(20:00〜21:00)のマスは押せない", closedCell);
  await ctx.close();
}

// ───────── スマホ（タッチ：長押ししてからドラッグ） ─────────
{
  const { ctx, page } = await open({ ...devices["iPhone 13"], defaultBrowserType: undefined });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: p.x, y: p.y }] });

  console.log("--- スマホ：長押し→ドラッグ／普通のスクロール");
  const a = await center(page, 1, "13:00"), b = await center(page, 1, "14:00");
  await touch("touchStart", a);
  await page.waitForTimeout(600); // 長押し
  for (let i = 1; i <= 6; i++) { await touch("touchMove", { x: a.x, y: a.y + ((b.y - a.y) * i) / 6 }); await page.waitForTimeout(20); }
  const pv = await page.getByTestId("drag-preview").textContent().catch(() => null);
  await touch("touchEnd");
  await page.waitForTimeout(400);
  const s = await sheetTimes(page).catch(() => null);
  check("長押し後になぞる 13:00→14:00 → 13:00〜14:15", s?.start === "13:00" && s?.end === "14:15", s ? `${s.start}〜${s.end}` : "シートが開かない");
  check("ドラッグ中にプレビューが出る", !!pv && pv.includes("13:00–14:15"), pv ?? "なし");
  await closeSheet(page);

  await cell(page, 1, "14:30").tap();
  await page.waitForTimeout(400);
  const s2 = await sheetTimes(page).catch(() => null);
  check("短くタップすると 14:30〜15:30（1時間）", s2?.start === "14:30" && s2?.end === "15:30", s2 ? `${s2.start}〜${s2.end}` : "なし");
  await closeSheet(page);

  const before = await page.evaluate(() => scrollY);
  const c = await center(page, 1, "15:00");
  await touch("touchStart", c);
  for (let i = 1; i <= 8; i++) { await touch("touchMove", { x: c.x, y: c.y - i * 25 }); await page.waitForTimeout(16); }
  await touch("touchEnd");
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => scrollY);
  const sheetOpen = await page.locator('[role="dialog"]').count();
  check("すぐに指を動かすと普通のスクロール（範囲選択にならない）", sheetOpen === 0 && after > before, `scroll ${before}→${after}`);

  await ctx.close();
}

// ───────── 一般の画面：メンテナンス枠は「予約不可」 ─────────
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await page.route(/\/rest\/v1\/rooms/, (r) => r.fulfill({ json: ROOMS }));
  await page.route(/\/rest\/v1\/booked_slots/, (r) => r.fulfill({ json: [...SLOTS, { room_id: 2, start_at: t("18:00"), end_at: t("19:00"), is_maint: true }] }));
  await page.route(/\/rest\/v1\/closures/, (r) => r.fulfill({ json: [] }));
  await page.route(/\/rest\/v1\/business_hours/, (r) => r.fulfill({ json: [] }));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  console.log("--- 一般の画面：メンテナンス・停止");
  check("メンテナンス枠は「メンテナンス」と表示され、中身は出ない", await page.getByText("メンテナンス").count() > 0);
  check("メンテナンスの時間は押せない", await cell(page, 2, "18:15").isDisabled().catch(() => true));
  await ctx.close();
}

// ───────── 管理画面：横向きの予約表 ─────────
const ADMIN_OPEN = 9 * 60, PX = 20 / 15;
/** 部屋 room の予約表の行で、時刻 time の枠の中ほどの画面座標（必要なら横スクロールして表示する） */
async function trackPoint(page, room, time) {
  const track = page.locator(`[data-track="${room}"]`);
  await track.evaluate((el, x) => { el.closest("[data-timeline]").scrollLeft = Math.max(0, x - 140); }, (M(time) - ADMIN_OPEN) * PX);
  const b = await track.boundingBox();
  return { x: b.x + (M(time) - ADMIN_OPEN) * PX + 7, y: b.y + b.height / 2 };
}
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await openAdmin(page, url);
  console.log("--- 管理画面（PC）：予約表");

  check("部屋が縦に並ぶ（5部屋）", await page.locator("[data-track]").count() === 5);
  check("仮予約は「仮」と表示", (await page.locator('[data-item="1"]').textContent())?.includes("仮"));
  check("レッスンに講師名が出る", (await page.locator('[data-item="4"]').textContent())?.includes("高山先生"));
  check("キャンセルは予約表に出ない（下の一覧に出る）",
    await page.locator('[data-item="8"]').count() === 0 && await page.getByText(/この日のキャンセル済み/).count() === 1);

  const p = await trackPoint(page, 1, "13:00");
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  const s = await sheetTimes(page).catch(() => null);
  check("空きをクリック → 13:00〜14:00 で新規予約", s?.start === "13:00" && s?.end === "14:00", s ? `${s.start}〜${s.end}` : "フォームが開かない");
  await page.getByLabel("開始時刻").selectOption(String(M("16:30")));
  await page.waitForTimeout(200);
  check("ほかの予約に重なる時間を選ぶと「重複」と出る", await page.getByText(/重複：17:15〜18:45 佐藤 花子/).count() === 1);
  await closeSheet(page);

  async function drag(room, from, to) {
    const a = await trackPoint(page, room, from);
    const b = { x: a.x + (M(to) - M(from)) * PX, y: a.y };
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y); await page.waitForTimeout(16); }
    const pv = await page.getByTestId("tl-preview").textContent().catch(() => null);
    await page.mouse.up();
    await page.waitForTimeout(400);
    return { pv, s: await sheetTimes(page).catch(() => null) };
  }
  const show = (d) => (d.s ? `${d.s.start}〜${d.s.end}` : "なし");
  let d = await drag(1, "13:00", "15:30");
  check("ドラッグ 13:00→15:30 → 13:00〜15:45", d.s?.start === "13:00" && d.s?.end === "15:45", show(d));
  check("ドラッグ中にプレビューが出る", !!d.pv?.includes("13:00-15:45"), d.pv ?? "なし");
  await closeSheet(page);
  d = await drag(1, "14:00", "19:00");
  check("次の予約(17:15〜)にかかる手前で止まる → 14:00〜17:15", d.s?.start === "14:00" && d.s?.end === "17:15", show(d));
  await closeSheet(page);
  d = await drag(1, "13:00", "10:00");
  check("左へのドラッグは前の予約(〜12:30)で止まる → 12:30〜13:15", d.s?.start === "12:30" && d.s?.end === "13:15", show(d));
  await closeSheet(page);
  d = await drag(2, "17:00", "20:30");
  check("予約不可枠(20:00〜)の手前で止まる → 17:00〜20:00", d.s?.start === "17:00" && d.s?.end === "20:00", show(d));
  await closeSheet(page);
  d = await drag(2, "9:00", "10:30");
  check("営業時間外(9:00〜)も管理者は選べる → 9:00〜10:45", d.s?.start === "9:00" && d.s?.end === "10:45", show(d));
  check("営業時間外は注意が出る", await page.getByText(/営業時間（10:00〜21:00）の外です/).count() === 1);
  await closeSheet(page);

  await page.locator('[data-item="4"]').click();
  await page.waitForTimeout(400);
  const dlg = page.getByRole("dialog");
  check("予約を押すと編集フォームが開き、内容が入っている",
    await dlg.getByText("予約の編集").count() >= 1 && await dlg.getByLabel("利用者名・団体名（必須）").inputValue() === "生徒 12");
  check("区分・講師・コースが入っている", await dlg.getByLabel("予約区分").inputValue() === "lesson"
    && await dlg.getByLabel("講師").inputValue() === "高山" && await dlg.getByLabel("コース").inputValue() === "ピアノ初級");
  await closeSheet(page);

  const q = await trackPoint(page, 3, "19:00");
  await page.mouse.click(q.x, q.y);
  await page.waitForTimeout(400);
  check("新規は区分「通常レッスン」・支払「無料」が初期値",
    await dlg.getByLabel("予約区分").inputValue() === "lesson" && await dlg.getByLabel("支払状況").inputValue() === "free");
  await dlg.getByLabel("予約区分").selectOption("rental");
  check("区分を一般貸出にすると支払は「未払い」に", await dlg.getByLabel("支払状況").inputValue() === "unpaid");
  check("受付担当の初期値はログイン中の管理者", await dlg.getByLabel("受付担当").inputValue() === "admin");
  await closeSheet(page);
  await ctx.close();
}
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"], defaultBrowserType: undefined, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await openAdmin(page, url);
  console.log("--- 管理画面（スマホ）：予約表");
  const p = await trackPoint(page, 1, "14:00");
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(500);
  const s = await sheetTimes(page).catch(() => null);
  check("タップ → 14:00〜15:00 で新規予約", s?.start === "14:00" && s?.end === "15:00", s ? `${s.start}〜${s.end}` : "フォームが開かない");
  await closeSheet(page);

  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pt) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: pt.x, y: pt.y }] });
  const box = page.locator("[data-timeline]");
  const q = await trackPoint(page, 1, "15:00");
  const b0 = await box.evaluate((el) => el.scrollLeft);
  await touch("touchStart", q);
  for (let i = 1; i <= 8; i++) { await touch("touchMove", { x: q.x - i * 25, y: q.y }); await page.waitForTimeout(16); }
  await touch("touchEnd");
  await page.waitForTimeout(500);
  const after = await box.evaluate((el) => el.scrollLeft);
  check("横になぞると予約表がスクロールし、新規予約は開かない", await page.locator('[role="dialog"]').count() === 0 && after > b0, `scroll ${b0}→${after}`);
  await ctx.close();
}

await browser.close();
console.log(`\n結果: ${ok} 件OK / ${ng} 件NG`);
process.exit(ng ? 1 : 0);
