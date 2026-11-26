// 画面の動作テスト（ドラッグ選択・時刻リストの絞り込み）。サンプルデータを使い、DB には触れない
//   npm run dev を起動した状態で: node scripts/test-ui.mjs [URL]
import { chromium, devices } from "playwright";

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

  const before = await page.evaluate(() => scrollY);
  const c = await center(page, 1, "15:00");
  await touch("touchStart", c);
  for (let i = 1; i <= 8; i++) { await touch("touchMove", { x: c.x, y: c.y - i * 25 }); await page.waitForTimeout(16); }
  await touch("touchEnd");
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => scrollY);
  const sheetOpen = await page.locator('[role="dialog"]').count();
  check("すぐに指を動かすと普通のスクロール（範囲選択にならない）", sheetOpen === 0 && after > before, `scroll ${before}→${after}`);

  await page.waitForTimeout(1500); // 慣性スクロールが止まるのを待つ（スクロール中のタップは「止める」操作になるため）
  await cell(page, 1, "14:30").tap();
  await page.waitForTimeout(400);
  const s2 = await sheetTimes(page).catch(() => null);
  check("短くタップすると 14:30〜15:30（1時間）", s2?.start === "14:30" && s2?.end === "15:30", s2 ? `${s2.start}〜${s2.end}` : "なし");
  await ctx.close();
}

await browser.close();
console.log(`\n結果: ${ok} 件OK / ${ng} 件NG`);
process.exit(ng ? 1 : 0);
