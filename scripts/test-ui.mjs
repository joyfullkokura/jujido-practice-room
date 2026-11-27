// 画面の動作テスト（ドラッグ選択・時刻リストの絞り込み）。サンプルデータを使い、DB には触れない
//   npm run dev を起動した状態で: node scripts/test-ui.mjs [URL]
import { chromium, devices } from "playwright";
import { openAdmin } from "./mock-admin.mjs";

const url = process.argv[2] ?? "http://localhost:3000";
const DAY = "2026-11-27";
const NOW = `${DAY}T09:00:00+09:00`; // 開店前に固定（過ぎた枠がない状態でテスト）
const ROOMS = [
  { id: 1, name: "2階 練習室A", color: "#4f7a87", capacity: 5, description: null, sort_order: 1, instruments: "ドラムセット" },
  { id: 2, name: "2階 練習室B", color: "#8a6474", capacity: 3, description: null, sort_order: 2, instruments: "電子ピアノ" },
];
const t = (hm) => `${DAY}T${hm}:00+09:00`;
// 部屋A: 11:00-12:30 と 17:15-18:45 が予約済 ／ 部屋B: 13:00-16:00
const SLOTS = [
  { room_id: 1, start_at: t("11:00"), end_at: t("12:30") },
  { room_id: 1, start_at: t("17:15"), end_at: t("18:45") },
  { room_id: 2, start_at: t("13:00"), end_at: t("16:00") },
  { room_id: 2, start_at: t("10:00"), end_at: t("11:00"), is_maint: true },  // メンテナンス
];
// 予約不可枠: 全部屋 20:00-21:00「店の都合」、営業時間は既定（10:00-21:00）
const CLOSURES = [{ id: 1, room_id: null, start_at: t("20:00"), end_at: t("21:00"), reason: "店の都合" }];

let ok = 0, ng = 0;
const check = (label, pass, detail = "") => { pass ? ok++ : ng++; console.log(`${pass ? "✅" : "❌"} ${label}${detail ? `  (${detail})` : ""}`); };
const hm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const M = (s) => { const [a, b] = s.split(":").map(Number); return a * 60 + b; };

const browser = await chromium.launch();
/** 一般の料金（税込）：有料の設定なら 1時間 1,000円＋税。PRICE_ON=false で「無料の設定」（null が返る） */
let PRICE_ON = true;
async function open(ctxOpts, path = "/", now = NOW) {
  const ctx = await browser.newContext({ ...ctxOpts, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(now));
  await page.route(/\/rest\/v1\/rpc\/public_quote/, (r) => {
    const b = r.request().postDataJSON();
    const h = (Date.parse(b.p_end_at) - Date.parse(b.p_start_at)) / 3600e3;
    const net = Math.round((1000 + 100 * ((b.p_people ?? 1) - 1)) * h);   // 2人目から +100円/時
    r.fulfill({ json: PRICE_ON ? net + Math.round(net * 0.1) : null });
  });
  await page.route(/\/rest\/v1\/rpc\/create_reservation/, (r) => r.fulfill({ json: 123 }));
  await page.route(/\/rest\/v1\/rooms/, (r) => r.fulfill({ json: ROOMS }));
  await page.route(/\/rest\/v1\/booked_slots/, (r) => r.fulfill({ json: SLOTS }));
  await page.route(/\/rest\/v1\/closures/, (r) => r.fulfill({ json: CLOSURES }));
  await page.route(/\/rest\/v1\/business_hours/, (r) => r.fulfill({ json: [] }));
  await page.goto(url + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { ctx, page };
}
const sheetTimes = async (page) => ({
  start: hm(Number(await page.getByLabel("開始時刻").inputValue())),
  end: hm(Number(await page.getByLabel("終了時刻").inputValue())),
});
const enabledOptions = async (page, label) =>
  (await page.getByLabel(label).locator("option:not([disabled])").evaluateAll((os) => os.map((o) => Number(o.value))))
    .map(hm).join(",");
const closeSheet = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(350); };

// ───────── 一般の予約画面（管理画面と同じ横向きの予約表） ─────────
// 営業時間は既定 10:00〜21:00 なので、予約表は 10:00 から始まる
const PUB_OPEN = 10 * 60, TPX = 20 / 15;
/** 予約表の部屋 room の行で、時刻 time の枠の中ほどの画面座標（必要なら横スクロールして表示する） */
async function pubPoint(page, room, time, open = PUB_OPEN) {
  const track = page.locator(`[data-track="${room}"]`);
  await track.evaluate((el, x) => { el.closest("[data-timeline]").scrollLeft = Math.max(0, x - 140); }, (M(time) - open) * TPX);
  const b = await track.boundingBox();
  return { x: b.x + (M(time) - open) * TPX + 7, y: b.y + b.height / 2 };
}
{
  const { ctx, page } = await open({ viewport: { width: 1366, height: 900 } });
  console.log("--- 一般の画面（PC）：表示");
  check("部屋が縦に並ぶ（2部屋）", await page.locator("[data-track]").count() === 2);
  check("部屋名と常設楽器を表示", ((await page.locator('[data-room="1"]').textContent()) ?? "").includes("練習室Aドラムセット"));
  const items = await page.locator("[data-item]").allTextContents();
  check("予約は「予約済」とだけ表示（名前・区分は出ない）", items.length === 3 && items.every((x) => /^\d+:\d+-\d+:\d+予約済$/.test(x)), items.join(" / "));
  check("区分の色分けはしない（予約済はすべて同じ灰色）", (await page.locator("[data-item]").evaluateAll((els) => els.map((e) => getComputedStyle(e).borderLeftColor))).every((c) => c === "rgb(115, 115, 115)"));
  check("予約済のブロックは押せない（ボタンではない）", (await page.locator("[data-item]").evaluateAll((els) => els.map((e) => e.tagName))).every((t) => t === "DIV"));
  check("メンテナンスは「メンテナンス」と表示", ((await page.locator('[data-track="2"]').textContent()) ?? "").includes("メンテナンス"));

  console.log("--- 一般の画面（PC）：ドラッグで範囲選択");
  async function drag(room, from, to) {
    const a = await pubPoint(page, room, from);
    const b = { x: a.x + (M(to) - M(from)) * TPX, y: a.y };
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y); await page.waitForTimeout(16); }
    const pv = await page.getByTestId("tl-preview").textContent().catch(() => null);
    await page.mouse.up();
    await page.waitForTimeout(400);
    return { pv, s: await sheetTimes(page).catch(() => null) };
  }
  const show = (d) => (d.s ? `${d.s.start}〜${d.s.end}` : "フォームが開かない");
  let d = await drag(1, "13:00", "14:45");
  check("13:00 から 14:45 の枠までなぞる → 13:00〜15:00", d.s?.start === "13:00" && d.s?.end === "15:00", show(d));
  check("ドラッグ中にプレビューが出る", !!d.pv?.includes("13:00-15:00"), d.pv ?? "なし");
  await closeSheet(page);
  d = await drag(1, "16:00", "18:30");
  check("次の予約(17:15)にかかる 16:00→18:30 は 17:15 で止まる", d.s?.start === "16:00" && d.s?.end === "17:15", show(d));
  await closeSheet(page);
  d = await drag(1, "12:30", "16:45");
  check("3時間を超える 12:30→16:45 は 12:30〜15:30 に縮む", d.s?.start === "12:30" && d.s?.end === "15:30", show(d));
  await closeSheet(page);
  d = await drag(1, "16:00", "11:30");
  check("左向き 16:00→11:30 は 予約(〜12:30)と3時間制限で 13:15〜16:15", d.s?.start === "13:15" && d.s?.end === "16:15", show(d));
  await closeSheet(page);
  d = await drag(2, "16:15", "20:45");
  check("予約不可枠(20:00〜)にかかる 16:15→20:45 は 16:15〜19:15（3時間）", d.s?.start === "16:15" && d.s?.end === "19:15", show(d));
  await closeSheet(page);
  d = await drag(1, "16:45", "16:45");
  check("押して動かさずに離す（=クリック）→ 1時間取れないので 16:45〜17:15 に縮む", d.s?.start === "16:45" && d.s?.end === "17:15", show(d));
  await closeSheet(page);

  let p = await pubPoint(page, 1, "12:45");
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  let s = await sheetTimes(page);
  check("クリックだけなら1時間 12:45〜13:45", s.start === "12:45" && s.end === "13:45", `${s.start}〜${s.end}`);

  console.log("--- 一般の画面（PC）：時刻リストの絞り込み");
  check("開始リスト：予約済(11:00〜12:15)と30分取れない10:45・19:45は選べない",
    !(await enabledOptions(page, "開始時刻")).split(",").some((x) => ["10:45", "11:00", "11:30", "12:15", "17:15", "18:30", "19:45", "20:00"].includes(x)));
  await page.getByLabel("開始時刻").selectOption(String(M("13:00")));
  await page.waitForTimeout(150);
  s = await sheetTimes(page);
  check("開始を 13:00 に変える → 長さ1時間を保って 13:00〜14:00", s.start === "13:00" && s.end === "14:00", `${s.start}〜${s.end}`);
  let ends = await enabledOptions(page, "終了時刻");
  check("終了リストは 13:30〜16:00（30分後〜3時間後）だけ選べる", ends === "13:30,13:45,14:00,14:15,14:30,14:45,15:00,15:15,15:30,15:45,16:00", ends);
  await page.waitForTimeout(400);
  check("料金（税込）を表示：1時間 ¥1,100", ((await page.getByTestId("public-price").textContent().catch(() => "")) ?? "").includes("¥1,100"));
  await page.getByLabel("終了時刻").selectOption(String(M("14:30")));
  await page.waitForTimeout(400);
  check("時間を変えると料金も変わる：1時間30分 ¥1,650", ((await page.getByTestId("public-price").textContent().catch(() => "")) ?? "").includes("¥1,650"));
  const peopleOpts = await page.getByRole("dialog").getByLabel("人数").locator("option").allTextContents();
  check("人数は 1人〜定員（5人）から選べる", peopleOpts.join(",") === "1人,2人,3人,4人,5人", peopleOpts.join(","));
  await page.getByRole("dialog").getByLabel("人数").selectOption("3");
  await page.waitForTimeout(400);
  check("人数を変えると料金も変わる：3人 1時間30分 = (1000+200)×1.5+税 ¥1,980", ((await page.getByTestId("public-price").textContent().catch(() => "")) ?? "").includes("¥1,980"));
  await page.getByRole("dialog").getByLabel("人数").selectOption("1");
  await page.getByLabel("終了時刻").selectOption(String(M("16:00")));
  await page.getByLabel("開始時刻").selectOption(String(M("16:30")));
  await page.waitForTimeout(150);
  s = await sheetTimes(page);
  ends = await enabledOptions(page, "終了時刻");
  check("開始を 16:30 に変える → 終了は次の予約の直前 17:15 に自動で縮む", s.end === "17:15", `${s.start}〜${s.end}`);
  check("終了リストは 17:00, 17:15 だけ選べる", ends === "17:00,17:15", ends);
  check("選べない終了時刻(18:00)は disabled（グレー）", await page.getByLabel("終了時刻").locator(`option[value="${M("18:00")}"]`).getAttribute("disabled") !== null);
  await page.getByRole("button", { name: "開始を15分遅く" }).click();
  s = await sheetTimes(page);
  check("＋ で開始 16:45、終了は 17:15 のまま（30分）", s.start === "16:45" && s.end === "17:15", `${s.start}〜${s.end}`);
  check("さらに ＋ は押せない（30分取れない）", await page.getByRole("button", { name: "開始を15分遅く" }).isDisabled());
  check("フォームに区分・料金の選択はない（名前・学校名・人数・時間だけ）",
    await page.getByRole("dialog").locator("input").count() === 2 && await page.getByRole("dialog").getByText("区分").count() === 0);
  await closeSheet(page);

  p = await pubPoint(page, 1, "20:15");
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  check("予約不可枠(20:00〜21:00)は押してもフォームが開かない", await page.locator('[role="dialog"]').count() === 0);
  p = await pubPoint(page, 2, "10:15");
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  check("メンテナンスの時間は押してもフォームが開かない", await page.locator('[role="dialog"]').count() === 0);

  console.log("--- 一般の画面（PC）：日付の移動");
  check("今日より前の日には戻れない", await page.getByRole("button", { name: "前の日" }).isDisabled());
  await page.getByRole("button", { name: "次の日" }).click();
  await page.waitForTimeout(400);
  check("「次の日」で 11月28日(土)", await page.getByLabel("日付").inputValue() === "2026-11-28" && await page.getByText("11月28日(土)").count() === 1);
  await page.getByLabel("日付").fill("2026-12-03");
  await page.waitForTimeout(400);
  check("日付を選んで移動できる", await page.getByText("12月3日(木)").count() === 1);
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await page.waitForTimeout(400);
  check("「今日」で戻る", await page.getByLabel("日付").inputValue() === DAY);
  await ctx.close();
}
{
  // 流入元（?from=）の記録
  const { ctx, page } = await open({ viewport: { width: 1366, height: 900 } }, "/?from=%E2%97%8B%E2%97%8B%E4%B8%AD");
  console.log("--- 一般の画面：流入元（?from=）");
  const req = page.waitForRequest((r) => /rpc\/create_reservation/.test(r.url()));
  const p = await pubPoint(page, 1, "13:00");
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  await page.getByRole("dialog").getByPlaceholder("十字 太郎").fill("テスト 花子");
  await page.getByRole("dialog").getByLabel("人数").selectOption("2");
  await page.getByRole("dialog").getByRole("button", { name: /で予約する/ }).click();
  const body = (await req).postDataJSON();
  check("?from=○○中 で開くと、予約に流入元「○○中」と人数が付く", body.p_source === "○○中" && body.p_name === "テスト 花子" && body.p_people === 2
    && body.p_start_at === t("13:00") && body.p_end_at === t("14:00"), JSON.stringify(body));
  await page.waitForTimeout(400);
  const doneText = (await page.getByRole("dialog").textContent()) ?? "";
  check("完了画面に人数と料金（税込）が出る：2人 1時間 ¥1,210", doneText.includes("人数2人") && doneText.includes("料金¥1,210（税込）"), doneText.slice(0, 80));
  await ctx.close();
}
{
  // スマホ：今の時刻（15:20）付近へ自動スクロール・部屋名の列は固定・タップで予約
  PRICE_ON = false;
  const { ctx, page } = await open({ ...devices["iPhone 13"], defaultBrowserType: undefined }, "/", `${DAY}T15:20:00+09:00`);
  console.log("--- 一般の画面（スマホ）");
  const box = page.locator("[data-timeline]");
  const sl = await box.evaluate((el) => el.scrollLeft);
  check("開くと今の時刻付近まで自動で横スクロール", sl > 300, `scrollLeft ${sl}`);
  const nowLine = await page.locator('[data-track="1"] .bg-red-600').boundingBox();
  check("現在時刻の線が画面内に見えている", !!nowLine && nowLine.x > 0 && nowLine.x < 390, nowLine ? `x=${Math.round(nowLine.x)}` : "なし");
  const label = await page.locator('[data-room="1"] > div').first().boundingBox();
  check("横スクロールしても部屋名の列は左に固定", !!label && Math.abs(label.x) < 2, label ? `x=${label.x}` : "なし");

  let p = await pubPoint(page, 1, "14:00");
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(500);
  check("過ぎた時間(14:00)はタップしても開かない", await page.locator('[role="dialog"]').count() === 0);
  p = await pubPoint(page, 1, "15:30");
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(600);
  const s = await sheetTimes(page).catch(() => null);
  check("タップ → 15:30〜16:30（1時間）でフォームが開く", s?.start === "15:30" && s?.end === "16:30", s ? `${s.start}〜${s.end}` : "フォームが開かない");
  check("無料の設定（料金が返らない）ときは料金を出さない", await page.getByTestId("public-price").count() === 0);
  await closeSheet(page);

  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pt) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: pt.x, y: pt.y }] });
  const q = await pubPoint(page, 1, "18:00");
  const b0 = await box.evaluate((el) => el.scrollLeft);
  await touch("touchStart", q);
  for (let i = 1; i <= 8; i++) { await touch("touchMove", { x: q.x - i * 25, y: q.y }); await page.waitForTimeout(16); }
  await touch("touchEnd");
  await page.waitForTimeout(500);
  const after = await box.evaluate((el) => el.scrollLeft);
  check("横になぞると予約表がスクロールし、フォームは開かない", await page.locator('[role="dialog"]').count() === 0 && after > b0, `scroll ${b0}→${after}`);
  await ctx.close();
  PRICE_ON = true;
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

// ───────── 管理画面：料金・定期レッスン・空き教室検索（フェーズ②） ─────────
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await openAdmin(page, url);
  const dlg = page.getByRole("dialog");
  const priceText = async () => { await page.waitForTimeout(450); return (await page.getByTestId("price").textContent().catch(() => "")) ?? ""; };
  const openNew = async (room, time) => { const p = await trackPoint(page, room, time); await page.mouse.click(p.x, p.y); await page.waitForTimeout(400); };

  console.log("--- 管理画面：料金（DB の関数で計算した値を表示）");
  await openNew(3, "19:00");
  check("レッスンは料金 0円", (await priceText()).includes("税込 ¥0"), await priceText());
  await dlg.getByLabel("予約区分").selectOption("rental");
  await dlg.getByLabel("人数").fill("2");
  await dlg.getByLabel("終了時刻").selectOption(String(M("20:30")));
  check("一般教室 2人 1時間30分 → 税抜 ¥1,650・税込 ¥1,815", /税抜 ¥1,650.*税込 ¥1,815/.test(await priceText()), await priceText());
  await dlg.getByLabel("割引（円・税抜）").fill("150");
  check("割引 150円 → 税込 ¥1,650", (await priceText()).includes("税込 ¥1,650"), await priceText());
  await dlg.getByLabel("料金の手動修正（税抜）").fill("1000");
  check("手動修正 1000円 → 税込 ¥1,100（割引より優先）", (await priceText()).includes("税込 ¥1,100"), await priceText());
  await closeSheet(page);

  await openNew(5, "16:00");
  await dlg.getByLabel("予約区分").selectOption("rental");
  check("ホールでは追加楽器を選べる", await dlg.getByText("ホールの追加楽器・設備").count() === 1);
  await dlg.getByRole("checkbox", { name: /グランドピアノ/ }).check();
  await dlg.getByRole("checkbox", { name: /その他打楽器/ }).check();
  check("ホール1時間＋グランドピアノ(500/時)＋打楽器(300/回) → 税抜 ¥2,300・税込 ¥2,530", /税抜 ¥2,300.*税込 ¥2,530/.test(await priceText()), await priceText());
  await closeSheet(page);
  await openNew(3, "19:00");
  check("ホール以外の部屋では追加楽器の欄は出ない", await dlg.getByText("ホールの追加楽器・設備").count() === 0);
  await closeSheet(page);

  console.log("--- 管理画面：定期レッスン");
  await openNew(3, "19:00");
  await dlg.getByLabel("利用者名・団体名（必須）").fill("生徒 7");
  await dlg.getByLabel("繰り返し", { exact: true }).selectOption("7");
  await dlg.getByLabel("繰り返しの終了日").fill("2026-12-18");
  await dlg.getByRole("button", { name: "登録する日を確認" }).click();
  await page.waitForTimeout(400);
  const plan = (await page.getByTestId("series-plan").textContent().catch(() => "")) ?? "";
  check("毎週4回のうち、登録できる2件・登録しない2件を事前に表示", plan.includes("登録できる 2件") && plan.includes("登録しない 2件"), plan.slice(0, 60));
  check("登録しない日の理由（重複・定休日）が一覧で出る", plan.includes("12月4日(金)") && plan.includes("重複：16:00〜17:00 生徒 3") && plan.includes("12月11日(金)") && plan.includes("定休日"));
  await dlg.getByRole("button", { name: "2件を登録する" }).click();
  await page.waitForTimeout(400);
  check("登録後に結果（登録2件・登録しなかった日2件）を表示", await dlg.getByText("定期レッスンを登録しました").count() === 1
    && await dlg.getByText(/登録 2件/).count() === 1 && await dlg.getByText(/登録しなかった日 2件/).count() === 1);
  await dlg.getByRole("button", { name: "閉じる" }).last().click();
  await page.waitForTimeout(400);
  await page.locator('[data-item="4"]').click();
  await page.waitForTimeout(400);
  check("定期の予約には「この定期を今日以降すべて削除」が出る", await dlg.getByRole("button", { name: "この定期を今日以降すべて削除" }).count() === 1);
  await closeSheet(page);
  await page.locator('[data-item="2"]').click();
  await page.waitForTimeout(400);
  check("定期でない予約には出ない", await dlg.getByRole("button", { name: "この定期を今日以降すべて削除" }).count() === 0);
  await closeSheet(page);

  console.log("--- 管理画面：空き教室検索");
  await page.getByRole("button", { name: "空き教室検索", exact: true }).click();
  await page.waitForTimeout(300);
  check("設備の候補は部屋の常設楽器から作られる", (await page.getByLabel("楽器・設備").locator("option").allTextContents()).join(",").includes("グランドピアノ"));
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.waitForTimeout(400);
  const list = page.getByRole("list", { name: "検索結果" });
  check("空いている部屋が料金つきで出る", await list.locator("li").count() === 4 && (await list.textContent()).includes("¥1,100"), (await list.textContent())?.slice(0, 80));
  await list.locator("li", { hasText: "L-1" }).getByRole("button", { name: "予約へ" }).click();
  await page.waitForTimeout(500);
  check("「予約へ」で予約表に移り、一般貸出の新規予約が開く", await dlg.getByText("新規予約").count() >= 1
    && await dlg.getByLabel("予約区分").inputValue() === "rental" && await dlg.getByLabel("部屋").inputValue() === "3");
  const s = await sheetTimes(page).catch(() => null);
  check("検索した時間（10:00〜11:00）が入っている", s?.start === "10:00" && s?.end === "11:00", s ? `${s.start}〜${s.end}` : "なし");
  await closeSheet(page);

  console.log("--- 管理画面：料金設定");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.getByRole("button", { name: "料金・楽器", exact: true }).click();
  await page.waitForTimeout(400);
  check("料金設定と一般予約の有料／無料の切り替えが出る", await page.getByLabel("一般教室 基本料金（円/時・税抜）").inputValue() === "1000"
    && await page.getByRole("checkbox", { name: /一般の予約画面（LINE から）の予約を有料にする/ }).isChecked());
  check("ホールの追加楽器が並ぶ", await page.locator('input[value="グランドピアノ"]').count() === 1);
  await ctx.close();
}

// ───────── 管理画面：売上・ダッシュボード・レポート（フェーズ③） ─────────
// サンプル（2026年11月・営業時間は既定 10:00〜21:00 で毎日営業・5部屋）
//   有効な予約 7件（キャンセル1件は除く）：一般貸出 90分×2（税込1,650 未払い／1,650 支払済）、メンテ 60分、レッスン60・パスポート60（利用済み）・体験90・イベント120
//   分母 = 30日 × 12時間 × 5部屋 − 予約不可(20-21時×5部屋) − メンテ60分 = 107,640分、予定 510分 → 0.5%
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await openAdmin(page, url);
  const tab = async (name) => { await page.getByRole("button", { name, exact: true }).click(); await page.waitForTimeout(700); };

  console.log("--- 管理画面：ダッシュボード");
  await tab("ダッシュボード");
  const kpi = (await page.getByTestId("kpi").textContent()) ?? "";
  check("稼働率（予定）0.5%・実績 0.1%", kpi.includes("稼働率（予定）0.5%実績 0.1%"), kpi.slice(0, 40));
  check("貸出売上 ¥3,300・2件、入金済 ¥1,650・未収 ¥1,650", kpi.includes("貸出売上（税込）・2件¥3,300") && kpi.includes("¥1,650未収 ¥1,650"), kpi);
  check("利用時間 8.5h（予約 510分）", kpi.includes("8.5h"), kpi);
  check("前月・前年同月はデータなし", await page.getByText("前月 データなし　／　前年同月 データなし").count() === 1);
  const cat = (await page.getByRole("list", { name: "区分別の利用時間" }).textContent()) ?? "";
  check("区分別：一般貸出 3h（35%）・イベント 2h（24%）", cat.includes("一般貸出3h（35%）") && cat.includes("イベント・発表会2h（24%）"), cat.slice(0, 80));
  check("区分別にメンテナンスは入らない", !cat.includes("メンテナンス"));
  check("ヒートマップ：金曜11時台 = (60+30)分 ÷ (5部屋×60分×4日) = 7.5%", await page.locator('td[title="金曜 11時台：7.5%"]').count() === 1);
  check("ヒートマップ：金曜20時台は利用なし 0.0%", await page.locator('td[title="金曜 20時台：0.0%"]').count() === 1);
  const rank = (await page.getByRole("list", { name: "貸出売上ランキング" }).locator("li").first().textContent()) ?? "";
  check("売上ランキング1位は 2階 練習室A ¥3,300", rank.includes("2階 練習室A") && rank.includes("¥3,300"), rank);
  const src = (await page.getByRole("list", { name: "流入元別の予約件数" }).locator("li").first().textContent()) ?? "";
  check("流入元別：電話・店頭（管理者）5件が最多", src.includes("電話・店頭（管理者）") && src.includes("5件"), src);
  check("学校別：○○中学校 1件", ((await page.getByRole("list", { name: "学校別の予約件数" }).textContent()) ?? "").includes("○○中学校1件"));
  const room = (await page.getByRole("list", { name: "部屋別の稼働率" }).locator("li").first().textContent()) ?? "";
  check("部屋別：練習室A 予定 180分 ÷ 21,540分 = 0.8%・目標 40%", room.includes("予定 0.8%") && room.includes("目標 40%"), room);
  await page.emulateMedia({ media: "print" });
  check("印刷時はヘッダー・操作ボタンを隠す", !(await page.locator("header").isVisible()) && !(await page.getByRole("button", { name: "印刷・PDF 保存" }).isVisible()));
  await page.emulateMedia({ media: "screen" });

  console.log("--- 管理画面：売上");
  await tab("売上");
  const sumText = async () => (await page.locator("dl").first().textContent()) ?? "";
  check("一般貸出だけが並ぶ（2件・合計 ¥3,300）", await page.locator("tbody tr").count() === 2 && (await page.locator("tfoot").textContent()).includes("¥3,300"));
  check("未払いの行は強調される", await page.locator("tr[data-unpaid]").count() === 1 && (await page.locator("tr[data-unpaid]").textContent()).includes("山田 太郎"));
  await page.getByLabel("山田 太郎 の支払状況").selectOption("paid");
  await page.waitForTimeout(400);
  check("支払済にすると未収が ¥0 になる", (await sumText()).includes("未収¥0"), await sumText());
  await page.getByLabel("未払いだけ").check();
  check("「未払いだけ」で絞り込める", await page.locator("tbody tr").count() === 0);

  console.log("--- 管理画面：レポート");
  await tab("レポート");
  const rows = page.getByRole("table", { name: "教室利用予定表" }).locator("tbody tr");
  check("その日の予約が時刻順に並ぶ（キャンセルは除く 7件）", await rows.count() === 7 && (await rows.first().textContent()).startsWith("10:00〜11:30"));
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "この日の確定をすべて利用済みにする" }).click();
  await page.waitForTimeout(500);
  check("「確定」5件をまとめて利用済みにできる", await page.getByText("5件を利用済みにしました。").count() === 1);
  await ctx.close();
}

// ───────── 管理画面：設定・変更履歴（フェーズ④） ─────────
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await openAdmin(page, url);
  console.log("--- 管理画面：設定・変更履歴");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.waitForTimeout(400);
  const subs = await page.getByRole("navigation", { name: "設定の項目" }).getByRole("button").allTextContents();
  check("設定に 教室・営業時間・臨時休業・料金・変更履歴 がまとまっている", subs.join(",") === "教室,営業時間・休業日,臨時休業・予約不可,料金・楽器,変更履歴", subs.join(","));

  await page.getByRole("button", { name: "営業時間・休業日", exact: true }).click();
  await page.waitForTimeout(400);
  check("集計・予約表の時間帯は設定値（9:00〜21:00）", await page.getByLabel("集計の開始").inputValue() === "540" && await page.getByLabel("集計の終了").inputValue() === "1260");
  const req = page.waitForRequest((r) => /shop_settings/.test(r.url()) && r.method() === "PATCH");
  await page.getByLabel("集計の開始").selectOption("480");
  await page.getByRole("button", { name: "保存", exact: true }).last().click();
  const body = (await req).postDataJSON();
  check("時間帯を 8:00〜21:00 に変えて保存できる", body.analysis_open === "08:00" && body.analysis_close === "21:00", JSON.stringify(body));

  await page.getByRole("button", { name: "変更履歴", exact: true }).click();
  await page.waitForTimeout(500);
  const items = page.getByRole("list", { name: "変更履歴" }).locator("li");
  const text = async (i) => (await items.nth(i).textContent()) ?? "";
  check("新しい順に並ぶ（5件）", await items.count() === 5 && (await text(0)).includes("10:05"));
  check("予約のキャンセル：誰が・何を・前→後", (await text(0)).includes("予約　#8を変更") && (await text(0)).includes("予約状況：確定 → キャンセル") && (await text(0)).includes("admin@example.com"), await text(0));
  check("一般の予約画面からの予約は「一般の予約画面」と出る", (await text(1)).includes("一般の予約画面") && (await text(1)).includes("山田 太郎") && (await text(1)).includes("区分：一般貸出"), await text(1));
  check("料金設定の変更：消費税率 8 → 10", (await text(2)).includes("料金設定を変更") && (await text(2)).includes("消費税率(%)：8 → 10"), await text(2));
  check("営業時間の変更：日曜日の定休日 いいえ → はい", (await text(3)).includes("営業時間　日曜日を変更") && (await text(3)).includes("定休日：いいえ → はい"), await text(3));
  check("SQL Editor での変更は「SQL Editor（システム）」", (await text(4)).includes("SQL Editor（システム）") && (await text(4)).includes("部屋　L-1を追加"), await text(4));
  await ctx.close();
}

await browser.close();
console.log(`\n結果: ${ok} 件OK / ${ng} 件NG`);
process.exit(ng ? 1 : 0);
