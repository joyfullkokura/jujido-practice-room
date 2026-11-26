"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, toISO, weekday } from "@/lib/date";
import { DEFAULT_CLOSE, DEFAULT_OPEN } from "@/lib/types";

/** "10:30:00" → 630 */
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export type HoursRow = { weekday: number; open_time: string; close_time: string; is_closed: boolean };
export type ClosureRow = { id?: number; room_id: number | null; start_at: string; end_at: string; reason: string | null };

/**
 * 営業時間（曜日ごと）と予約不可枠を読み込む。
 * テーブルがまだ無い（migration 004 の前）・読めないときは、既定値 10:00〜21:00・予約不可なし
 */
export function useShopCalendar(from?: string, to?: string, reloadKey = 0) {
  const [hours, setHours] = useState<HoursRow[] | null>(null);
  const [closures, setClosures] = useState<ClosureRow[]>([]);

  useEffect(() => {
    supabase.from("business_hours").select("weekday, open_time, close_time, is_closed")
      .then(({ data, error }) => setHours(error ? null : (data ?? [])));
  }, [reloadKey]);

  useEffect(() => {
    if (!from || !to) return;
    supabase.from("closures").select("id, room_id, start_at, end_at, reason")
      .lt("start_at", toISO(addDays(to, 1), 0)).gt("end_at", toISO(from, 0))
      .then(({ data, error }) => setClosures(error ? [] : (data ?? [])));
  }, [from, to, reloadKey]);

  /** その日の営業時間。null は休業日 */
  const hoursOf = useCallback((date: string): { open: number; close: number } | null => {
    const row = hours?.find((r) => r.weekday === weekday(date));
    if (!row) return { open: DEFAULT_OPEN, close: DEFAULT_CLOSE };
    return row.is_closed ? null : { open: toMin(row.open_time), close: toMin(row.close_time) };
  }, [hours]);

  /** その部屋・その日にかかる予約不可枠（日をまたぐ枠はその日の分だけに切る） */
  const closedOf = useCallback((roomId: number, date: string) => {
    const dayStart = Date.parse(toISO(date, 0)), dayEnd = dayStart + 24 * 3600e3;
    return closures
      .filter((c) => c.room_id == null || c.room_id === roomId)
      .map((c) => ({ s: Math.max(Date.parse(c.start_at), dayStart), e: Math.min(Date.parse(c.end_at), dayEnd), label: c.reason ?? undefined }))
      .filter((c) => c.e > c.s)
      .map((c) => ({ start: Math.round((c.s - dayStart) / 60000), end: Math.round((c.e - dayStart) / 60000), label: c.label }));
  }, [closures]);

  /** グリッドの縦の範囲：営業日のうち最も早い開店〜最も遅い閉店 */
  const range = useMemo(() => {
    const open = (hours ?? []).filter((r) => !r.is_closed);
    if (!open.length) return { open: DEFAULT_OPEN, close: DEFAULT_CLOSE };
    return {
      open: Math.floor(Math.min(...open.map((r) => toMin(r.open_time))) / 60) * 60,
      close: Math.ceil(Math.max(...open.map((r) => toMin(r.close_time))) / 60) * 60,
    };
  }, [hours]);

  return { hours, closures, hoursOf, closedOf, range };
}
