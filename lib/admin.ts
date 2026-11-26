// 管理画面のデータ操作。すべてログイン中の管理者の権限で行い、可否は DB の RLS が判定する
import { supabase } from "@/lib/supabase";
import { fromISO, toISO, addDays } from "@/lib/date";
import { fmtMin } from "@/lib/types";

export type ReservationRow = {
  id: number; room_id: number; start_at: string; end_at: string;
  name: string; school: string | null; source: string | null;
  status: "confirmed" | "cancelled"; created_at: string; cancelled_at: string | null;
};
export type RoomRow = {
  id: number; name: string; color: string; capacity: number | null;
  description: string | null; sort_order: number; is_public: boolean;
};

export async function fetchReservations(from: string, to: string) {
  return supabase.from("reservations")
    .select("id, room_id, start_at, end_at, name, school, source, status, created_at, cancelled_at")
    .gte("start_at", toISO(from, 0)).lt("start_at", toISO(addDays(to, 1), 0))
    .order("start_at").returns<ReservationRow[]>();
}

export async function fetchAllRooms() {
  return supabase.from("rooms").select("id, name, color, capacity, description, sort_order, is_public")
    .order("sort_order").order("id").returns<RoomRow[]>();
}

/** DB のエラーを、店頭で読んでわかる文に */
export function explain(error: { code?: string; message: string } | null): string {
  if (!error) return "";
  switch (error.code) {
    case "23P01": return "その時間はほかの予約と重なっています。";
    case "23503": return "この部屋には予約が残っているため削除できません。代わりに「非公開」にしてください。";
    case "23514": return "入力内容を確認してください（文字数・時刻の単位など）。";
    case "42501": return "権限がありません。管理者のアカウントでログインしているか確認してください。";
    case "P0001": return error.message;
    default: return `保存できませんでした（${error.message}）`;
  }
}

/** 予約の表示用 */
export function describe(r: ReservationRow) {
  const s = fromISO(r.start_at), e = fromISO(r.end_at);
  return { date: s.date, start: s.min, end: e.date === s.date ? e.min : 24 * 60, time: `${fmtMin(s.min)}〜${fmtMin(e.min)}` };
}

const fmtStamp = (iso: string | null) => {
  if (!iso) return "";
  const d = fromISO(iso);
  return `${d.date} ${fmtMin(d.min)}`;
};
export const sourceLabel = (s: string | null) => (s === "admin" ? "電話・店頭（管理者）" : s ?? "");

/** 予約一覧の CSV（Excel で文字化けしないよう BOM 付き UTF-8） */
export function toCSV(rows: ReservationRow[], rooms: RoomRow[]) {
  const head = ["予約ID", "日付", "開始", "終了", "部屋", "名前", "学校名", "流入元", "状態", "作成日時", "キャンセル日時"];
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => {
    const d = describe(r);
    return [r.id, d.date, fmtMin(d.start), fmtMin(d.end), rooms.find((x) => x.id === r.room_id)?.name ?? r.room_id,
      r.name, r.school ?? "", sourceLabel(r.source), r.status === "cancelled" ? "キャンセル" : "確定",
      fmtStamp(r.created_at), fmtStamp(r.cancelled_at)].map(esc).join(",");
  });
  return "﻿" + [head.join(","), ...lines].join("\r\n");
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { fmtStamp };
