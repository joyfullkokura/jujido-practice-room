// 管理画面のデータ操作。すべてログイン中の管理者の権限で行い、可否は DB の RLS が判定する
import { supabase } from "@/lib/supabase";
import { fromISO, toISO, addDays } from "@/lib/date";
import { fmtMin } from "@/lib/types";
import { CATEGORIES, PAYMENTS, STATUSES, type Category, type Payment, type Status } from "@/lib/booking";

export type ReservationRow = {
  id: number; room_id: number; start_at: string; end_at: string;
  name: string; school: string | null; source: string | null;
  status: Status; created_at: string; cancelled_at: string | null;
  category: Category; teacher: string | null; course: string | null; people: number;
  contact: string | null; staff: string | null; note: string | null; payment: Payment;
  extras: string[]; discount: number; price_override: number | null; deleted_at: string | null;
};
export const RESERVATION_COLS =
  "id, room_id, start_at, end_at, name, school, source, status, created_at, cancelled_at, category, teacher, course, people, contact, staff, note, payment, extras, discount, price_override, deleted_at";
export type RoomRow = {
  id: number; name: string; color: string; capacity: number | null;
  description: string | null; sort_order: number; is_public: boolean;
  instruments: string | null; is_hall: boolean; target_rate: number; sales_target: number;
};
export const ROOM_COLS = "id, name, color, capacity, description, sort_order, is_public, instruments, is_hall, target_rate, sales_target";

/** 期間内の予約（削除したものは除く） */
export async function fetchReservations(from: string, to: string) {
  return supabase.from("reservations").select(RESERVATION_COLS)
    .gte("start_at", toISO(from, 0)).lt("start_at", toISO(addDays(to, 1), 0))
    .is("deleted_at", null)
    .order("start_at").returns<ReservationRow[]>();
}

export async function fetchAllRooms() {
  return supabase.from("rooms").select(ROOM_COLS)
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
  const head = ["予約ID", "日付", "開始", "終了", "部屋", "区分", "利用者名", "学校名", "講師", "コース", "人数", "予約状況", "支払状況",
    "連絡先", "受付担当", "備考", "流入元", "作成日時", "キャンセル日時"];
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => {
    const d = describe(r);
    return [r.id, d.date, fmtMin(d.start), fmtMin(d.end), rooms.find((x) => x.id === r.room_id)?.name ?? r.room_id,
      CATEGORIES[r.category]?.label ?? r.category, r.name, r.school ?? "", r.teacher ?? "", r.course ?? "", r.people,
      STATUSES[r.status] ?? r.status, PAYMENTS[r.payment] ?? r.payment, r.contact ?? "", r.staff ?? "", r.note ?? "",
      sourceLabel(r.source), fmtStamp(r.created_at), fmtStamp(r.cancelled_at)].map(esc).join(",");
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
