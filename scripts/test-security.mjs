// 権限テスト（一般利用者 = anon の立場で実行）: node --env-file=.env.local scripts/test-security.mjs
// テスト予約は 2099年のランダムな日付に、名前 "__TEST__" で入ります
//   削除（SQL Editor）: delete from reservations where name = '__TEST__';
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_KEY,
  { auth: { persistSession: false } });
let ok = 0, ng = 0;
const check = (label, pass, detail = "") => {
  pass ? ok++ : ng++;
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? `  (${detail})` : ""}`);
};
const denied = (r) => !!r.error || (Array.isArray(r.data) && r.data.length === 0);
const desc = (r) => (r.error ? `${r.error.code} ${r.error.message}` : `data=${JSON.stringify(r.data)?.slice(0, 80)}`);

const rooms = (await sb.from("rooms").select("id, name, is_public").order("sort_order").order("id")).data ?? [];
const ROOM = rooms[0]?.id, OTHER = rooms[1]?.id;
const date = new Date(Date.UTC(2099, 0, 1 + Math.floor(Math.random() * 360))).toISOString().slice(0, 10);
const at = (hm, d = date) => `${d}T${hm}:00+09:00`;
const book = (s, e, extra = {}) => sb.rpc("create_reservation", {
  p_room_id: ROOM, p_start_at: at(s), p_end_at: at(e),
  p_name: "__TEST__", p_school: "テスト校", p_source: "test", ...extra });
const ranges = async (room = ROOM) =>
  ((await sb.from("booked_slots").select("start_at, end_at").eq("room_id", room)
    .gte("start_at", at("00:00")).lt("start_at", at("23:59"))).data ?? [])
    .map((r) => {
      const f = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(11, 16);
      return `${f(r.start_at)}-${f(r.end_at)}`;
    }).sort().join(",");

console.log(`--- 予約の流れ（テスト日 ${date}、部屋 ${rooms[0]?.name}）`);
let r = await book("15:15", "16:45");
check("15:15〜16:45 を予約できる", !r.error, desc(r));
check("予約済として 15:15-16:45 が見える", (await ranges()) === "15:15-16:45", await ranges());

console.log("--- 15分単位の重複チェック");
r = await book("15:15", "16:45");
check("まったく同じ時間は拒否 (23P01)", r.error?.code === "23P01", desc(r));
r = await book("16:30", "17:00");
check("終わりの15分だけ重なる 16:30〜17:00 は拒否", r.error?.code === "23P01", desc(r));
r = await book("14:30", "15:30");
check("始めの15分だけ重なる 14:30〜15:30 は拒否", r.error?.code === "23P01", desc(r));
r = await book("15:30", "16:00");
check("内側に入る 15:30〜16:00 は拒否", r.error?.code === "23P01", desc(r));
r = await book("15:00", "17:30");
check("外側から包む 15:00〜17:30 は拒否", r.error?.code === "23P01", desc(r));
r = await book("16:45", "17:15");
check("ちょうど続く 16:45〜17:15 は予約できる", !r.error, desc(r));
r = await book("14:45", "15:15");
check("ちょうど前に続く 14:45〜15:15 は予約できる", !r.error, desc(r));
check("予約済が 3件 正しく見える", (await ranges()) === "14:45-15:15,15:15-16:45,16:45-17:15", await ranges());
if (OTHER) {
  r = await sb.rpc("create_reservation", { p_room_id: OTHER, p_start_at: at("15:15"), p_end_at: at("16:45"), p_name: "__TEST__" });
  check("別の部屋なら同じ時間でも予約できる（重複判定は部屋ごと）", !r.error, desc(r));
}

console.log("--- 入力チェック");
r = await book("10:00", "10:15");
check("15分だけ（30分未満）は拒否", r.error?.code === "P0001", desc(r));
r = await book("17:30", "20:45");
check("3時間15分（3時間超）は拒否", r.error?.code === "P0001", desc(r));
r = await book("18:10", "19:10");
check("15分単位でない時刻 18:10 は拒否", r.error?.code === "P0001", desc(r));
r = await book("09:45", "10:30");
check("開店前 9:45 開始は拒否", r.error?.code === "P0001", desc(r));
r = await book("20:30", "21:15");
check("閉店後 21:15 終了は拒否", r.error?.code === "P0001", desc(r));
r = await book("17:00", "16:30");
check("終了が開始より前は拒否", r.error?.code === "P0001", desc(r));
r = await sb.rpc("create_reservation", { p_room_id: ROOM, p_start_at: at("11:00", "2020-01-01"), p_end_at: at("12:00", "2020-01-01"), p_name: "__TEST__" });
check("過去の予約は拒否", r.error?.code === "P0001", desc(r));
r = await book("19:00", "20:00", { p_name: "   " });
check("名前が空なら拒否", r.error?.code === "P0001", desc(r));
r = await sb.rpc("create_reservation", { p_room_id: 999999, p_start_at: at("19:00"), p_end_at: at("20:00"), p_name: "__TEST__" });
check("存在しない部屋は拒否", r.error?.code === "P0001", desc(r));
r = await sb.rpc("create_reservation", { p_room_id: ROOM, p_date: date, p_start_hour: 19, p_end_hour: 20, p_name: "__TEST__" });
check("古い形式（時単位）の関数はもう使えない", !!r.error, desc(r));

console.log("--- 部屋");
check("部屋が2つ以上取得できる", rooms.length >= 2, rooms.map((x) => x.name).join(" / "));
check("anon に見える部屋はすべて公開中", rooms.every((x) => x.is_public === true));

console.log("--- 個人情報が読めないこと");
r = await sb.from("reservations").select("name, school, source");
check("reservations の名前・学校名は読めない", denied(r), desc(r));
r = await sb.from("reservations").select("id");
check("reservations はどの列も読めない", denied(r), desc(r));
const has005 = !(await sb.from("booked_slots").select("is_maint").limit(1)).error;
r = await sb.from("booked_slots").select("*").limit(1);
const cols = Object.keys(r.data?.[0] ?? {}).sort().join(",");
check(has005 ? "booked_slots の列は room_id/start_at/end_at/is_maint だけ（名前・講師・区分などは出ない）" : "booked_slots の列は room_id/start_at/end_at だけ",
  cols === (has005 ? "end_at,is_maint,room_id,start_at" : "end_at,room_id,start_at"), cols);
if (has005) {
  r = await sb.from("reservations").select("category, teacher, contact, note");
  check("reservations の区分・講師・連絡先・備考は読めない", denied(r), desc(r));
  r = await sb.from("rooms").select("id, sales_target, target_rate");
  check("一般の人は部屋の売上目標・目標稼働率を読めない", !!r.error, desc(r));
  r = await sb.from("rooms").select("id, name, instruments, is_hall");
  check("一般の人も公開中の部屋の常設楽器は読める", !r.error && r.data?.length >= 1, desc(r));
  r = await sb.rpc("create_reservation", { p_room_id: ROOM, p_start_at: at("19:00"), p_end_at: at("20:00"), p_name: "__TEST__", p_category: "lesson" });
  check("一般の予約で区分は指定できない（そういう引数はない）", !!r.error, desc(r));
}
r = await sb.schema("backup").from("reservations_003").select("name").limit(1);
check("バックアップ（backup スキーマ）は読めない", denied(r), desc(r));

console.log("--- 予約を書き換え・削除できないこと");
r = await sb.from("reservations").insert({ room_id: ROOM, start_at: at("19:00"), end_at: at("20:00"), name: "__TEST__" });
check("reservations へ直接 insert できない", !!r.error, desc(r));
r = await sb.from("reservations").update({ status: "cancelled" }).gte("start_at", at("00:00")).select();
check("reservations を update（キャンセル）できない", denied(r), desc(r));
r = await sb.from("reservations").delete().gte("start_at", at("00:00")).select();
check("reservations を delete できない", denied(r), desc(r));
r = await sb.from("booked_slots").delete().gte("start_at", at("00:00"));
check("booked_slots 経由で delete できない", !!r.error, desc(r));
r = await sb.from("booked_slots").update({ end_at: at("21:00") }).gte("start_at", at("00:00"));
check("booked_slots 経由で update できない", !!r.error, desc(r));
check("テスト予約が消えずに残っている", (await ranges()) === "14:45-15:15,15:15-16:45,16:45-17:15");
r = await sb.from("rooms").insert({ name: "__TEST__" });
check("rooms に追加できない", !!r.error, desc(r));
r = await sb.from("rooms").update({ name: "x" }).eq("id", ROOM).select();
check("rooms を書き換えられない", denied(r), desc(r));

// ───────── ここから管理者まわり（migration 004 以降） ─────────
const has004 = !(await sb.from("business_hours").select("weekday").limit(1)).error;
if (!has004) {
  console.log("\n⚠ business_hours が無いため、管理者まわりのテストはスキップ（migration 004 の実行後に有効）");
} else {
  console.log("--- 一般の利用者（anon）と営業時間・予約不可枠");
  r = await sb.from("business_hours").select("weekday, open_time, close_time, is_closed");
  check("営業時間は誰でも読める（7曜日）", r.data?.length === 7, desc(r));
  r = await sb.from("business_hours").update({ is_closed: true }).eq("weekday", 0).select();
  check("anon は営業時間を変えられない", denied(r), desc(r));
  r = await sb.from("closures").insert({ room_id: null, start_at: at("10:00"), end_at: at("11:00"), reason: "__TEST__" });
  check("anon は予約不可枠を追加できない", !!r.error, desc(r));
  r = await sb.from("admins").select("user_id");
  check("anon は admins を読めない", denied(r), desc(r));
  r = await sb.rpc("is_admin");
  check("anon の is_admin() は false", r.data === false, desc(r));

  const env = process.env;
  if (!env.TEST_ADMIN_EMAIL || !env.TEST_USER_EMAIL) {
    console.log("\n⚠ .env.test.local（TEST_ADMIN_EMAIL など）が無いため、ログインが必要なテストはスキップ");
    ng++;
  } else {
    const login = async (email, password) => {
      const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_KEY, { auth: { persistSession: false } });
      const { error } = await c.auth.signInWithPassword({ email, password });
      return { c, error };
    };

    console.log("--- ログインしているが管理者ではないユーザー");
    const { c: u, error: ue } = await login(env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD);
    check("テスト用ユーザーでログインできる", !ue, ue?.message);
    r = await u.rpc("is_admin");
    check("is_admin() は false", r.data === false, desc(r));
    // 管理者として登録されていた場合、下の「できないこと」の確認が本当に書き込んでしまうので中止する
    if (r.data !== false) {
      console.log("⚠ TEST_USER が管理者として扱われています。本番データを書き換えないよう、このユーザーの確認を中止します");
      ng++;
    } else {
    r = await u.from("reservations").select("name, school").gte("start_at", at("00:00"));
    check("予約の名前・学校名は読めない", denied(r), desc(r));
    if (has005) {
      r = await u.from("reservations").select("contact, teacher, note");
      check("連絡先・講師・備考は読めない", denied(r), desc(r));
      r = await u.from("reservations").update({ category: "maint" }).gte("start_at", at("00:00")).select();
      check("区分を書き換えられない", denied(r), desc(r));
    }
    r = await u.from("reservations").update({ status: "cancelled" }).gte("start_at", at("00:00")).select();
    check("予約をキャンセルできない", denied(r), desc(r));
    r = await u.from("reservations").insert({ room_id: ROOM, start_at: at("19:00"), end_at: at("20:00"), name: "__TEST__" });
    check("予約を直接入れられない（代理予約できない）", !!r.error, desc(r));
    r = await u.from("rooms").insert({ name: "__TEST__" });
    check("部屋を追加できない", !!r.error, desc(r));
    r = await u.from("rooms").update({ name: "x" }).eq("id", ROOM).select();
    check("部屋を編集できない", denied(r), desc(r));
    r = await u.from("rooms").delete().eq("id", ROOM).select();
    check("部屋を削除できない", denied(r), desc(r));
    r = await u.from("closures").insert({ room_id: null, start_at: at("10:00"), end_at: at("11:00"), reason: "__TEST__" });
    check("予約不可枠を追加できない", !!r.error, desc(r));
    r = await u.from("business_hours").update({ is_closed: true }).eq("weekday", 0).select();
    check("営業時間を変えられない", denied(r), desc(r));
    r = await u.from("admins").insert({ user_id: (await u.auth.getUser()).data.user?.id });
    check("自分を管理者に登録できない", !!r.error, desc(r));
    }
    await u.auth.signOut();

    console.log("--- 管理者");
    const { c: a, error: ae } = await login(env.TEST_ADMIN_EMAIL, env.TEST_ADMIN_PASSWORD);
    check("管理者でログインできる", !ae, ae?.message);
    r = await a.rpc("is_admin");
    check("is_admin() は true", r.data === true, desc(r));
    r = await a.from("reservations").select("id, name, school, source, status, start_at").eq("room_id", ROOM)
      .gte("start_at", at("00:00")).lt("start_at", at("23:59")).order("start_at");
    check("管理者は名前・学校名・流入元を読める", r.data?.length === 3 && r.data.every((x) => x.name === "__TEST__"), desc(r));
    const main = r.data?.find((x) => x.start_at.includes("06:15")); // 15:15 JST
    r = await a.from("reservations").update({ status: "cancelled" }).eq("id", main?.id).select("status, cancelled_at");
    check("キャンセルできる（キャンセル日時は自動で記録）", r.data?.[0]?.status === "cancelled" && !!r.data?.[0]?.cancelled_at, desc(r));
    check("キャンセルした枠は空き状況から消える", (await ranges()) === "14:45-15:15,16:45-17:15", await ranges());
    r = await book("15:30", "16:00");
    check("空いた枠に一般の予約が入る", !r.error, desc(r));
    r = await a.from("reservations").update({ status: "confirmed" }).eq("id", main?.id).select();
    check("重なる予約があるとキャンセルの取り消しは拒否 (23P01)", r.error?.code === "23P01", desc(r));
    const blocker = (await a.from("reservations").select("id").eq("room_id", ROOM).eq("status", "confirmed").eq("start_at", at("15:30"))).data?.[0]?.id;
    await a.from("reservations").update({ status: "cancelled" }).eq("id", blocker);
    r = await a.from("reservations").update({ status: "confirmed" }).eq("id", main?.id).select("status, cancelled_at");
    check("重なりがなくなれば取り消せる（キャンセル日時は消える）", r.data?.[0]?.status === "confirmed" && r.data?.[0]?.cancelled_at === null, desc(r));
    r = await a.from("reservations").insert({ room_id: ROOM, start_at: at("19:00"), end_at: at("20:00"), name: "__TEST__", source: "admin" });
    check("代理予約できる", !r.error, desc(r));
    r = await a.from("reservations").insert({ room_id: ROOM, start_at: at("19:30"), end_at: at("20:30"), name: "__TEST__", source: "admin" });
    check("代理予約でも重なりは拒否 (23P01)", r.error?.code === "23P01", desc(r));

    r = await a.from("closures").insert({ room_id: ROOM, start_at: at("18:00"), end_at: at("19:00"), reason: "__TEST__" }).select("id");
    const closureId = r.data?.[0]?.id;
    check("予約不可枠を追加できる", !!closureId, desc(r));
    r = await sb.from("closures").select("room_id, reason").eq("id", closureId);
    check("予約不可枠は一般の利用者にも見える", r.data?.[0]?.reason === "__TEST__", desc(r));
    r = await book("18:00", "18:30");
    check("予約不可枠の時間は一般の予約を拒否", r.error?.code === "P0001", desc(r));
    r = await a.from("closures").delete().eq("id", closureId).select();
    check("予約不可枠を削除できる", r.data?.length === 1, desc(r));
    r = await book("18:00", "18:30");
    check("削除後はその時間を予約できる", !r.error, desc(r));

    r = await a.from("rooms").insert({ name: "__TEST__", color: "#6b6b6b", is_public: false, sort_order: 999 }).select("id");
    const testRoom = r.data?.[0]?.id;
    check("部屋を追加できる（非公開）", !!testRoom, desc(r));
    r = await sb.from("rooms").select("id").eq("id", testRoom);
    check("非公開の部屋は一般の利用者に見えない", denied(r), desc(r));
    r = await sb.rpc("create_reservation", { p_room_id: testRoom, p_start_at: at("12:00"), p_end_at: at("13:00"), p_name: "__TEST__" });
    check("非公開の部屋は一般の予約を拒否", r.error?.code === "P0001", desc(r));
    r = await a.from("rooms").update({ description: "テスト" }).eq("id", testRoom).select();
    check("部屋を編集できる", r.data?.length === 1, desc(r));
    r = await a.from("rooms").delete().eq("id", testRoom).select();
    check("予約のない部屋は削除できる", r.data?.length === 1, desc(r));
    r = await a.from("rooms").delete().eq("id", ROOM).select();
    check("予約が残っている部屋は削除できない (23503)", r.error?.code === "23503", desc(r));

    const wd = new Date(date + "T00:00:00Z").getUTCDay();
    const cur = (await a.from("business_hours").select("open_time, close_time, is_closed").eq("weekday", wd)).data?.[0];
    r = await a.from("business_hours").update(cur).eq("weekday", wd).select();
    check("営業時間を更新できる（同じ値で上書きして確認）", r.data?.length === 1, desc(r));
    if (has005) {
      console.log("--- 管理者：予約の区分・項目（migration 005）");
      const pub = (await a.from("reservations").select("category, people, payment, status").eq("id", main?.id)).data?.[0];
      check("一般の予約は「一般貸出・1人・未払い」で入る", pub?.category === "rental" && pub?.people === 1 && pub?.payment === "unpaid", JSON.stringify(pub));
      const ins = (row) => a.from("reservations").insert({ room_id: ROOM, name: "__TEST__", ...row }).select("id, deleted_at");
      r = await ins({ start_at: at("10:00"), end_at: at("11:00"), category: "lesson", teacher: "テスト講師", course: "ピアノ初級",
        people: 2, contact: "000-0000-0000", staff: "test", note: "テスト", payment: "free" });
      const lesson = r.data?.[0]?.id;
      check("レッスン（講師・コース・人数・連絡先・受付担当・備考つき）を登録できる", !!lesson, desc(r));
      check("レッスンも一般の画面では「予約済」の時間帯として見える", (await ranges()).includes("10:00-11:00"), await ranges());
      r = await sb.from("booked_slots").select("is_maint").eq("room_id", ROOM).eq("start_at", at("10:00"));
      check("レッスンは is_maint=false（中身は見えない）", r.data?.[0]?.is_maint === false, desc(r));
      r = await book("10:30", "11:30");
      check("区分が違っても重なる一般予約は拒否 (23P01)", r.error?.code === "23P01", desc(r));
      r = await ins({ start_at: at("11:00"), end_at: at("12:00"), category: "rental", status: "tentative" });
      check("仮予約を登録できる", !!r.data?.[0]?.id, desc(r));
      r = await book("11:30", "12:00");
      check("仮予約の時間も一般の予約を拒否 (23P01)", r.error?.code === "23P01", desc(r));
      r = await ins({ start_at: at("11:45"), end_at: at("12:15"), category: "event" });
      check("仮予約と重なる管理者の登録も拒否 (23P01)", r.error?.code === "23P01", desc(r));
      r = await ins({ start_at: at("12:00"), end_at: at("13:00"), category: "maint" });
      const maint = r.data?.[0]?.id;
      check("メンテナンス・停止を登録できる", !!maint, desc(r));
      r = await sb.from("booked_slots").select("is_maint").eq("room_id", ROOM).eq("start_at", at("12:00"));
      check("メンテナンスは一般の画面で is_maint=true", r.data?.[0]?.is_maint === true, desc(r));
      r = await ins({ start_at: at("13:00"), end_at: at("13:30"), category: "xxx" });
      check("存在しない区分は拒否 (23514)", r.error?.code === "23514", desc(r));
      r = await ins({ start_at: at("13:00"), end_at: at("13:30"), status: "foo" });
      check("存在しない予約状況は拒否 (23514)", r.error?.code === "23514", desc(r));
      r = await ins({ start_at: at("13:00"), end_at: at("13:30"), payment: "maybe" });
      check("存在しない支払状況は拒否 (23514)", r.error?.code === "23514", desc(r));
      r = await a.from("reservations").update({ status: "used" }).eq("id", lesson).select("status");
      check("利用済みにできる", r.data?.[0]?.status === "used", desc(r));
      check("利用済みも時間を占める", (await ranges()).includes("10:00-11:00"), await ranges());
      r = await a.from("reservations").update({ start_at: at("11:30"), end_at: at("12:30") }).eq("id", lesson).select();
      check("ほかの予約に重なる時間への変更は拒否 (23P01)", r.error?.code === "23P01", desc(r));
      r = await a.from("reservations").update({ source: "x" }).eq("id", lesson).select();
      check("管理者でも流入元は書き換えられない", !!r.error, desc(r));
      r = await a.from("reservations").update({ deleted_at: "2000-01-01T00:00:00Z" }).eq("id", maint).select("deleted_at");
      const delAt = r.data?.[0]?.deleted_at;
      check("削除できる（削除日時は DB が今の時刻で記録）", !!delAt && !delAt.startsWith("2000"), desc(r));
      check("削除した枠は一般の画面から消える", !(await ranges()).includes("12:00-13:00"), await ranges());
      r = await book("12:00", "12:30");
      check("削除した枠の時間は予約できる", !r.error, desc(r));
      r = await a.from("reservations").select("id").eq("id", maint).not("deleted_at", "is", null);
      check("削除した予約も行は残っている（管理者は確認できる）", r.data?.length === 1, desc(r));

      r = await a.from("rooms").select("name, is_hall, capacity, instruments, target_rate, sales_target")
        .in("name", ["L-1", "M-3", "L-2", "S-5", "M-2", "M-1", "S-6", "ホール"]);
      check("8教室が入っている", r.data?.length === 8, desc(r));
      check("ホールは is_hall=true・定員30", r.data?.some((x) => x.name === "ホール" && x.is_hall && x.capacity === 30), desc(r));
      check("管理者は目標稼働率・売上目標を読める", r.data?.every((x) => typeof x.target_rate === "number" && typeof x.sales_target === "number"), desc(r));
    } else {
      console.log("\n⚠ migration 005 が未実行のため、予約の区分・項目のテストはスキップ");
    }
    const has006 = !(await a.from("price_settings").select("id").limit(1)).error;
    if (has006) {
      console.log("--- 料金・定期レッスン・空き教室検索（migration 006）");
      const plus = (n) => new Date(Date.parse(date + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
      const seriesArgs = (o = {}) => ({ p_room_id: ROOM, p_first: date, p_start_min: 600, p_end_min: 660, p_every_days: 7, p_until: plus(28),
        p_fields: { name: "__TEST__", course: "__SERIES__", category: "lesson" }, p_dry_run: true, ...o });
      const searchArgs = (o = {}) => ({ p_date: date, p_start_min: 15 * 60 + 30, p_minutes: 60, p_people: 1, p_keyword: "", ...o });

      // 一般の人
      r = await sb.from("price_settings").select("*");
      check("一般の人は料金設定を読めない", denied(r), desc(r));
      r = await sb.from("price_settings").update({ tax_rate: 0 }).eq("id", 1).select();
      check("一般の人は料金設定を変えられない", denied(r), desc(r));
      r = await sb.from("hall_extras").insert({ name: "__TEST__" });
      check("一般の人はホールの楽器を追加できない", !!r.error, desc(r));
      r = await sb.rpc("quote_price", { p_category: "rental", p_room_id: ROOM, p_start_at: at("10:00"), p_end_at: at("11:00") });
      check("一般の人は料金計算の関数を呼べない", !!r.error, desc(r));
      r = await sb.rpc("create_series", seriesArgs({ p_dry_run: false }));
      check("一般の人は定期登録を使えない", !!r.error, desc(r));
      r = await sb.rpc("search_free_rooms", searchArgs());
      check("一般の人は空き教室検索（管理者用）を使えない", !!r.error, desc(r));
      // ログインしているだけのユーザー
      const { c: u2 } = await login(env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD);
      if ((await u2.rpc("is_admin")).data === false) {
        r = await u2.from("price_settings").update({ tax_rate: 0 }).eq("id", 1).select();
        check("管理者でないユーザーは料金設定を変えられない", denied(r), desc(r));
        r = await u2.rpc("create_series", seriesArgs({ p_dry_run: false }));
        check("管理者でないユーザーは定期登録を使えない", !!r.error, desc(r));
        r = await u2.rpc("search_free_rooms", searchArgs());
        check("管理者でないユーザーは空き教室検索を使えない", !!r.error, desc(r));
      }
      await u2.auth.signOut();

      // 料金計算（DB の quote_price）。期待値は今の料金設定から同じ式で計算
      const S = (await a.from("price_settings").select("*").eq("id", 1).single()).data;
      const tax = (net) => Math.round((net * S.tax_rate) / 100);
      const qp = async (o = {}) => (await a.rpc("quote_price", { p_category: "rental", p_room_id: ROOM, p_start_at: at("10:00"), p_end_at: at("11:30"),
        p_people: 2, p_extras: [], p_discount: 0, p_override: null, ...o })).data?.[0];
      const base15 = Math.round((S.base_per_hour + S.add_per_person) * 1.5);
      let q = await qp();
      check(`一般教室 2人 1時間30分 = (基本+追加)×1.5 = 税抜 ${base15}`, q?.net === base15 && q?.tax === tax(base15) && q?.total === base15 + tax(base15), JSON.stringify(q));
      q = await qp({ p_discount: 100 });
      check("割引は税抜から引く", q?.net === Math.max(0, base15 - 100), JSON.stringify(q));
      q = await qp({ p_discount: 9999999 });
      check("割引が大きすぎても 0円未満にならない", q?.net === 0 && q?.total === 0, JSON.stringify(q));
      q = await qp({ p_override: 1234, p_discount: 100 });
      check("手動修正があればその額（割引より優先）", q?.net === 1234 && q?.total === 1234 + tax(1234), JSON.stringify(q));
      q = await qp({ p_category: "lesson" });
      check("一般貸出以外は 0円", q?.total === 0, JSON.stringify(q));
      const hall = (await a.from("rooms").select("id").eq("is_hall", true).limit(1)).data?.[0]?.id;
      const tmp = (await a.from("hall_extras").insert([{ name: "__TEST__時間", price: 500, unit: "hour" }, { name: "__TEST__回", price: 300, unit: "once" }]).select("id")).data ?? [];
      try {
        q = await qp({ p_room_id: hall, p_people: 5, p_extras: ["__TEST__時間", "__TEST__回"] });
        const hb = Math.round(S.hall_per_hour * 1.5), hx = Math.round(500 * 1.5 + 300);
        check(`ホール 1時間30分＋楽器(500/時・300/回) = ${hb}+${hx}（人数は関係なし）`, q?.base === hb && q?.extras === hx && q?.net === hb + hx, JSON.stringify(q));
      } finally {
        await a.from("hall_extras").delete().in("id", tmp.map((x) => x.id));
      }

      // 予約に保存される料金
      r = await a.from("reservations").insert({ room_id: ROOM, name: "__TEST__", start_at: at("13:00"), end_at: at("14:00"), category: "rental", people: 3 })
        .select("id, price_net, price_total");
      const rent = r.data?.[0];
      const n3 = S.base_per_hour + 2 * S.add_per_person;
      check(`保存時に料金が記録される（3人1時間 = 税抜 ${n3}）`, rent?.price_net === n3 && rent?.price_total === n3 + tax(n3), desc(r));
      r = await a.from("reservations").update({ people: 1 }).eq("id", rent?.id).select("price_net");
      check("人数を変えると料金も計算し直される", r.data?.[0]?.price_net === S.base_per_hour, desc(r));
      r = await a.from("reservations").update({ note: "x" }).eq("id", rent?.id).select("price_net");
      check("料金に関係ない項目の変更では料金は変わらない", r.data?.[0]?.price_net === S.base_per_hour, desc(r));
      r = await a.from("reservations").update({ price_total: 1 }).eq("id", rent?.id).select();
      check("料金の列は画面から直接書き換えられない", !!r.error, desc(r));
      const pubRow = (await a.from("reservations").select("price_net, payment").eq("room_id", ROOM).eq("start_at", at("12:00")).eq("status", "confirmed").is("deleted_at", null)).data?.[0];
      const half = Math.round(S.base_per_hour * 0.5);
      check(`一般の予約（30分）にも料金が記録される（有料設定なら税抜 ${half}）`, S.public_charge ? pubRow?.price_net === half : pubRow?.price_net === 0, JSON.stringify(pubRow));
      // 一般予約を無料にする設定（テスト後に元へ戻す）
      try {
        await a.from("price_settings").update({ public_charge: false }).eq("id", 1);
        r = await book("20:00", "20:30");
        const free = (await a.from("reservations").select("payment, price_total").eq("id", r.data).single()).data;
        check("「一般予約を有料にする」をオフにすると、一般の予約は無料・0円で入る", free?.payment === "free" && free?.price_total === 0, JSON.stringify(free));
      } finally {
        await a.from("price_settings").update({ public_charge: S.public_charge }).eq("id", 1);
      }
      check("料金設定を元に戻した", (await a.from("price_settings").select("public_charge").eq("id", 1).single()).data?.public_charge === S.public_charge);

      // 定期レッスン
      const cl = (await a.from("closures").insert({ room_id: null, start_at: at("10:00", plus(14)), end_at: at("11:00", plus(14)), reason: "__TEST__" }).select("id")).data?.[0]?.id;
      try {
        const seriesBefore = (await a.from("reservations").select("id").eq("course", "__SERIES__")).data?.length;
        r = await a.rpc("create_series", seriesArgs());
        const pl = r.data ?? [];
        const reasonOf = (n) => pl.find((x) => x.day === plus(n))?.reason ?? "";
        check("定期の確認：5回のうち登録できるのは3回", pl.length === 5 && pl.filter((x) => x.ok).length === 3, desc(r));
        check("ほかの予約と重なる日は「重複」として外す", !pl.find((x) => x.day === date)?.ok && reasonOf(0).startsWith("重複"), reasonOf(0));
        check("予約不可枠の日は外し、理由を返す", reasonOf(14) === "予約不可（__TEST__）", reasonOf(14));
        r = await a.from("reservations").select("id").eq("course", "__SERIES__");
        check("確認だけ（dry run）では登録されない（呼ぶ前と件数が同じ）", r.data?.length === seriesBefore, `${seriesBefore}→${r.data?.length}`);
        r = await a.rpc("create_series", seriesArgs({ p_dry_run: false }));
        const made = (r.data ?? []).filter((x) => x.ok && x.id);
        check("定期を登録すると3件入る", made.length === 3, desc(r));
        r = await a.from("reservations").select("series_id, source").in("id", made.map((x) => x.id));
        const sid = r.data?.[0]?.series_id;
        check("3件とも同じ series_id・流入元は admin", !!sid && r.data.every((x) => x.series_id === sid && x.source === "admin"), desc(r));
        r = await a.from("reservations").update({ deleted_at: new Date().toISOString() }).eq("series_id", sid).is("deleted_at", null)
          .gte("start_at", at("00:00", plus(21))).select("id");
        check("指定日以降の定期をまとめて削除できる（2件）", r.data?.length === 2, desc(r));
        r = await a.from("reservations").select("id").eq("series_id", sid).is("deleted_at", null);
        check("それより前の1件は残る", r.data?.length === 1, desc(r));
      } finally {
        await a.from("closures").delete().eq("id", cl);
      }

      // 空き教室検索
      r = await a.rpc("search_free_rooms", searchArgs());
      const ids = (r.data ?? []).map((x) => x.room_id);
      check("予約が入っている部屋は検索結果に出ない", !r.error && !ids.includes(ROOM) && (!OTHER || !ids.includes(OTHER)), desc(r));
      const any = r.data?.find((x) => !x.is_hall);
      const exp = any && (await qp({ p_room_id: any.room_id, p_people: 1, p_start_at: at("15:30"), p_end_at: at("16:30") }));
      check("検索結果の料金は quote_price と同じ", !!any && any.total === exp?.total, `${any?.name} ${any?.total} / ${exp?.total}`);
      r = await a.rpc("search_free_rooms", searchArgs({ p_keyword: "ホール" }));
      check("設備「ホール」で絞るとホールだけ", r.data?.length >= 1 && r.data.every((x) => x.is_hall), desc(r));
      r = await a.rpc("search_free_rooms", searchArgs({ p_keyword: "グランドピアノ" }));
      check("楽器で絞ると、その楽器がある部屋だけ", r.data?.length >= 1 && r.data.every((x) => (x.instruments ?? "").includes("グランドピアノ")), desc(r));
      r = await a.rpc("search_free_rooms", searchArgs({ p_people: 31 }));
      check("定員より多い人数では出ない", !r.error && r.data.every((x) => x.capacity == null || x.capacity >= 31), desc(r));
    } else {
      console.log("\n⚠ migration 006 が未実行のため、料金・定期・空き教室検索のテストはスキップ");
    }
    const has008 = !(await a.from("shop_settings").select("id").limit(1)).error;
    if (has008) {
      console.log("--- 変更履歴・お店の設定（migration 008）");
      r = await sb.from("audit_log").select("id").limit(1);
      check("一般の人は変更履歴を読めない", denied(r), desc(r));
      r = await sb.from("shop_settings").select("*");
      check("一般の人はお店の設定を読めない", denied(r), desc(r));
      r = await sb.from("shop_settings").update({ analysis_open: "05:00" }).eq("id", 1).select();
      check("一般の人はお店の設定を変えられない", denied(r), desc(r));
      const { c: u3 } = await login(env.TEST_USER_EMAIL, env.TEST_USER_PASSWORD);
      if ((await u3.rpc("is_admin")).data === false) {
        r = await u3.from("audit_log").select("id").limit(1);
        check("管理者でないユーザーは変更履歴を読めない", denied(r), desc(r));
        r = await u3.from("shop_settings").update({ analysis_open: "05:00" }).eq("id", 1).select();
        check("管理者でないユーザーはお店の設定を変えられない", denied(r), desc(r));
      }
      await u3.auth.signOut();

      const logsOf = async (table, id) => (await a.from("audit_log").select("actor_kind, actor_email, action, before, after")
        .eq("table_name", table).eq("row_id", String(id)).order("id")).data ?? [];
      r = await a.from("reservations").insert({ room_id: ROOM, name: "__TEST__", start_at: at("14:00"), end_at: at("14:30"), category: "rental", people: 2 }).select("id");
      const rid = r.data?.[0]?.id;
      let logs = await logsOf("reservations", rid);
      check("管理者の予約登録が履歴に残る（管理者のメールつき）", logs[0]?.action === "insert" && logs[0]?.actor_kind === "admin"
        && logs[0]?.actor_email?.toLowerCase() === env.TEST_ADMIN_EMAIL.toLowerCase() && logs[0]?.after?.name === "__TEST__", JSON.stringify(logs[0])?.slice(0, 120));
      await a.from("reservations").update({ people: 1 }).eq("id", rid);
      logs = await logsOf("reservations", rid);
      const upd = logs.find((x) => x.action === "update");
      check("変更は「変わった列」の前→後だけ記録（人数 2→1 と料金）", upd?.before?.people === 2 && upd?.after?.people === 1 && !("name" in (upd?.after ?? {})), JSON.stringify(upd)?.slice(0, 160));
      await a.from("reservations").update({ note: null }).eq("id", rid);
      check("何も変わらない更新は記録しない", (await logsOf("reservations", rid)).length === 2);
      await a.from("reservations").update({ deleted_at: new Date().toISOString() }).eq("id", rid);
      logs = await logsOf("reservations", rid);
      check("削除（論理削除）も記録される", !!logs.at(-1)?.after?.deleted_at, JSON.stringify(logs.at(-1))?.slice(0, 120));

      r = await book("20:30", "21:00");
      logs = await logsOf("reservations", r.data);
      check("一般の予約画面からの予約は「public」として記録（メールなし）", logs[0]?.actor_kind === "public" && logs[0]?.actor_email == null, JSON.stringify(logs[0])?.slice(0, 100));

      r = await a.from("closures").insert({ room_id: null, start_at: at("09:00"), end_at: at("09:30"), reason: "__TEST__" }).select("id");
      const cid = r.data?.[0]?.id;
      await a.from("closures").delete().eq("id", cid);
      logs = await logsOf("closures", cid);
      check("予約不可枠の追加・削除が記録される（削除は消す前の内容つき）", logs.length === 2 && logs[1]?.action === "delete" && logs[1]?.before?.reason === "__TEST__", JSON.stringify(logs)?.slice(0, 120));

      const anyLog = (await a.from("audit_log").select("id").order("id", { ascending: false }).limit(1)).data?.[0]?.id;
      r = await a.from("audit_log").insert({ actor_kind: "admin", table_name: "x", action: "insert" });
      check("管理者でも履歴を追加できない", !!r.error, desc(r));
      r = await a.from("audit_log").update({ actor_email: "x" }).eq("id", anyLog).select();
      check("管理者でも履歴を書き換えられない", denied(r), desc(r));
      r = await a.from("audit_log").delete().eq("id", anyLog).select();
      check("管理者でも履歴を削除できない", denied(r), desc(r));
      check("履歴は残っている", (await a.from("audit_log").select("id").eq("id", anyLog)).data?.length === 1);

      const cur = (await a.from("shop_settings").select("analysis_open, analysis_close").eq("id", 1).single()).data;
      r = await a.from("shop_settings").update(cur).eq("id", 1).select();
      check("管理者はお店の設定を更新できる（同じ値で確認）", r.data?.length === 1, desc(r));
      r = await a.from("shop_settings").update({ analysis_open: "21:00", analysis_close: "09:00" }).eq("id", 1).select();
      check("終了が開始より前の時間帯は拒否 (23514)", r.error?.code === "23514", desc(r));
    } else {
      console.log("\n⚠ migration 008 が未実行のため、変更履歴のテストはスキップ");
    }
    const pq = (room, s, e) => sb.rpc("public_quote", { p_room_id: room, p_start_at: at(s), p_end_at: at(e) });
    const has009 = !(await pq(ROOM, "10:00", "11:00")).error;
    if (has009) {
      console.log("--- 一般の予約画面の料金・試作の部屋の削除（migration 009）");
      const S9 = (await a.from("price_settings").select("*").eq("id", 1).single()).data;
      const taxed = (net) => net + Math.round((net * S9.tax_rate) / 100);
      r = await pq(ROOM, "10:00", "11:30");
      check(`一般の人も料金（税込）だけは取得できる：1時間30分 = ${S9.public_charge ? taxed(Math.round(S9.base_per_hour * 1.5)) : "（無料設定なので null）"}`,
        !r.error && r.data === (S9.public_charge ? taxed(Math.round(S9.base_per_hour * 1.5)) : null), desc(r));
      const hallPub = (await sb.from("rooms").select("id").eq("is_hall", true).limit(1)).data?.[0]?.id;
      if (hallPub && S9.public_charge) {
        r = await pq(hallPub, "10:00", "11:00");
        check("公開中のホールはホール料金（1人・追加楽器なし）", r.data === taxed(S9.hall_per_hour), desc(r));
      }
      r = await pq(999999, "10:00", "11:00");
      check("存在しない・非公開の部屋は料金を返さない (null)", !r.error && r.data === null, desc(r));
      r = await pq(ROOM, "10:00", "13:30");
      check("3時間を超える時間は料金を返さない (null)", !r.error && r.data === null, desc(r));
      try {
        await a.from("price_settings").update({ public_charge: false }).eq("id", 1);
        r = await pq(ROOM, "10:00", "11:00");
        check("「一般予約を有料にする」がオフなら料金を返さない (null)", !r.error && r.data === null, desc(r));
      } finally {
        await a.from("price_settings").update({ public_charge: S9.public_charge }).eq("id", 1);
      }
      r = await a.from("rooms").select("id").in("name", ["2階 練習室A", "2階 練習室B"]);
      check("試作用の「2階 練習室A／B」は削除されている", r.data?.length === 0, desc(r));
      r = await sb.from("rooms").select("name, is_public");
      check("一般の人に見える部屋はすべて公開中（1部屋以上）", r.data?.length >= 1 && r.data.every((x) => x.is_public), (r.data ?? []).map((x) => x.name).join(" / "));
    } else {
      console.log("\n⚠ migration 009 が未実行のため、一般の料金表示のテストはスキップ");
    }
    r = await a.from("admins").insert({ user_id: "00000000-0000-0000-0000-000000000000" });
    check("管理者でも API から管理者を追加できない（SQL Editor のみ）", !!r.error, desc(r));
    await a.auth.signOut();
  }
}

console.log(`\n結果: ${ok} 件OK / ${ng} 件NG`);
console.log("テスト予約の削除（SQL Editor）: delete from reservations where name = '__TEST__';");
process.exit(ng ? 1 : 0);
