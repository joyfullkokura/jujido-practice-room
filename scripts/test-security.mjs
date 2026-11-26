// 権限テスト（一般利用者 = anon の立場で実行）: node --env-file=.env.local scripts/test-security.mjs
// テスト予約は 2099年のランダムな日付に入ります（後で SQL で削除してください）
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

const ROOM = 1;
const date = new Date(Date.UTC(2099, 0, 1 + Math.floor(Math.random() * 360))).toISOString().slice(0, 10);
const rpc = (start, end, extra = {}) => sb.rpc("create_reservation", {
  p_room_id: ROOM, p_date: date, p_start_hour: start, p_end_hour: end,
  p_name: "__TEST__", p_school: "テスト校", p_source: "test", ...extra });
const bookedHours = async () =>
  ((await sb.from("booked_slots").select("start_hour").eq("room_id", ROOM).eq("date", date)).data ?? [])
    .map((r) => r.start_hour).sort((a, b) => a - b);

console.log(`--- 予約の流れ（テスト日 ${date}）`);
let r = await rpc(13, 15);
check("13:00〜15:00 をまとめて予約できる", !r.error, desc(r));
check("予約済として 13, 14 が見える", JSON.stringify(await bookedHours()) === "[13,14]");
r = await rpc(13, 15);
check("同じ枠への二重予約は 23505 エラー", r.error?.code === "23505", desc(r));
r = await rpc(14, 16);
check("一部が重なる予約もエラー", r.error?.code === "23505", desc(r));
check("失敗した予約の残り(15時)は入っていない", JSON.stringify(await bookedHours()) === "[13,14]");
r = await rpc(15, 19);
check("4時間の予約は拒否", r.error?.code === "P0001", desc(r));
r = await sb.rpc("create_reservation", { p_room_id: ROOM, p_date: "2020-01-01", p_start_hour: 11, p_end_hour: 12, p_name: "__TEST__" });
check("過去の予約は拒否", r.error?.code === "P0001", desc(r));
r = await rpc(8, 9);
check("営業時間外(8時)は拒否", r.error?.code === "P0001", desc(r));
r = await rpc(16, 17, { p_name: "   " });
check("名前が空なら拒否", r.error?.code === "P0001", desc(r));

console.log("--- 部屋（フェーズ2）");
const rooms = (await sb.from("rooms").select("id, name, is_public").order("sort_order")).data ?? [];
check("部屋が2つ以上取得できる", rooms.length >= 2, rooms.map((x) => x.name).join(" / "));
check("anon に見える部屋はすべて公開中", rooms.every((x) => x.is_public === true));
const other = rooms.find((x) => x.id !== ROOM);
if (other) {
  r = await sb.rpc("create_reservation", { p_room_id: other.id, p_date: date, p_start_hour: 13, p_end_hour: 15, p_name: "__TEST__" });
  check("別の部屋なら同じ時間でも予約できる（重複判定は部屋ごと）", !r.error, desc(r));
  r = await sb.rpc("create_reservation", { p_room_id: other.id, p_date: date, p_start_hour: 14, p_end_hour: 15, p_name: "__TEST__" });
  check("その別の部屋でも二重予約は 23505 エラー", r.error?.code === "23505", desc(r));
}
r = await sb.rpc("create_reservation", { p_room_id: 999999, p_date: date, p_start_hour: 16, p_end_hour: 17, p_name: "__TEST__" });
check("存在しない部屋は予約できない", r.error?.code === "P0001", desc(r));

console.log("--- 個人情報が読めないこと");
r = await sb.from("reservations").select("name, school, source");
check("reservations の名前・学校名は読めない", denied(r), desc(r));
r = await sb.from("reservations").select("id");
check("reservations はどの列も読めない", denied(r), desc(r));
r = await sb.from("booked_slots").select("*").limit(1);
const cols = Object.keys(r.data?.[0] ?? {}).sort().join(",");
check("booked_slots の列は room_id/date/start_hour/group_id だけ", cols === "date,group_id,room_id,start_hour", cols);

console.log("--- 予約を書き換え・削除できないこと");
r = await sb.from("reservations").insert({ room_id: ROOM, date, start_hour: 18, name: "__TEST__" });
check("reservations へ直接 insert できない", !!r.error, desc(r));
r = await sb.from("reservations").update({ name: "x" }).eq("date", date).select();
check("reservations を update できない", denied(r), desc(r));
r = await sb.from("reservations").delete().eq("date", date).select();
check("reservations を delete できない", denied(r), desc(r));
r = await sb.from("booked_slots").delete().eq("date", date);
check("booked_slots 経由で delete できない", !!r.error, desc(r));
r = await sb.from("booked_slots").update({ start_hour: 20 }).eq("date", date);
check("booked_slots 経由で update できない", !!r.error, desc(r));
check("テスト予約が消えずに残っている", JSON.stringify(await bookedHours()) === "[13,14]");
r = await sb.from("rooms").insert({ name: "__TEST__" });
check("rooms に追加できない", !!r.error, desc(r));
r = await sb.from("rooms").update({ name: "x" }).eq("id", ROOM).select();
check("rooms を書き換えられない", denied(r), desc(r));

console.log(`\n結果: ${ok} 件OK / ${ng} 件NG`);
console.log("テスト予約の削除（SQL Editor）: delete from reservations where name = '__TEST__';");
process.exit(ng ? 1 : 0);
