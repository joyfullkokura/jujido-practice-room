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
r = await sb.from("booked_slots").select("*").limit(1);
const cols = Object.keys(r.data?.[0] ?? {}).sort().join(",");
check("booked_slots の列は room_id/start_at/end_at だけ", cols === "end_at,room_id,start_at", cols);
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

console.log(`\n結果: ${ok} 件OK / ${ng} 件NG`);
console.log("テスト予約の削除（SQL Editor）: delete from reservations where name = '__TEST__';");
process.exit(ng ? 1 : 0);
