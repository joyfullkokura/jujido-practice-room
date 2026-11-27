"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, fmtDate, nowJST } from "@/lib/date";
import { CATEGORIES, CATEGORY_KEYS, isActive } from "@/lib/booking";
import { useShopCalendar } from "@/lib/useShopCalendar";
import { describe, explain, fetchReservations, fetchWindow, type ReservationRow, type RoomRow } from "@/lib/admin";
import Timeline, { type TLRow } from "@/components/Timeline";
import BookingEditor, { draftOf, newDraft, type Draft } from "@/components/admin/BookingEditor";
import { Button, Notice, inputCls } from "@/components/ui";
import type { SearchPick } from "@/components/admin/SearchTab";


export default function DayTab({ rooms, staff, pick, onPickUsed }: {
  rooms: RoomRow[]; staff: string;
  /** 空き教室検索から「予約へ」で来たとき：その日を開いて一般貸出の新規予約フォームを出す */
  pick?: SearchPick | null; onPickUsed?: () => void;
}) {
  const [now, setNow] = useState(nowJST);
  const [date, setDate] = useState(() => nowJST().date);
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<Draft | null>(null);
  const { hoursOf, closedOf, range: shopRange } = useShopCalendar(date, date, reloadKey);
  // 予約表の時間帯：設定（既定 9:00〜21:00）を基本に、営業時間がそれより広ければ広げる
  const [base, setBase] = useState({ open: 9 * 60, close: 21 * 60 });
  useEffect(() => { fetchWindow().then(setBase); }, []);
  const range = { open: Math.min(base.open, shopRange.open), close: Math.max(base.close, shopRange.close) };

  useEffect(() => { const t = setInterval(() => setNow(nowJST()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!pick) return;
    setDate(pick.date);
    setEditing(newDraft({ ...pick, staff, category: "rental" }));
    onPickUsed?.();
  }, [pick, staff, onPickUsed]);

  const load = useCallback(async () => {
    const { data, error } = await fetchReservations(date, date);
    setError(error ? explain(error) : "");
    setRows(data ?? []);
  }, [date]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const active = rows.filter(isActive);
  const cancelled = rows.filter((r) => r.status === "cancelled");

  const tlRows: TLRow[] = useMemo(() => rooms.map((room) => ({
    id: room.id, name: room.name, note: room.instruments ?? undefined, badge: room.is_public ? undefined : "非公開",
    closed: closedOf(room.id, date),
    items: active.filter((r) => r.room_id === room.id).map((r) => {
      const d = describe(r);
      return { id: r.id, start: d.start, end: d.end, color: CATEGORIES[r.category]?.color ?? "#6b6b6b",
        tentative: r.status === "tentative", used: r.status === "used",
        title: r.name, sub: [r.teacher && `${r.teacher}先生`, r.course, r.school].filter(Boolean).join("・") };
    }),
  })), [rooms, active, closedOf, date]);

  const undo = async (r: ReservationRow) => {
    const { error } = await supabase.from("reservations").update({ status: "confirmed" }).eq("id", r.id);
    if (error) return alert(explain(error));
    setReloadKey((k) => k + 1);
  };

  const open = (p: { room_id: number; start: number; end: number }) => setEditing(newDraft({ date, staff, ...p }));
  const hours = hoursOf(date);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 md:px-0">
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="日付"
          className={`${inputCls} max-w-44 tabular-nums`} />
        <Button onClick={() => setDate(nowJST().date)}>今日</Button>
        <div className="flex">
          <Button className="rounded-r-none px-3" aria-label="前の日" onClick={() => setDate((d) => addDays(d, -1))}>‹</Button>
          <Button className="-ml-px rounded-l-none px-3" aria-label="次の日" onClick={() => setDate((d) => addDays(d, 1))}>›</Button>
        </div>
        <Button variant="primary" onClick={() => open({ room_id: rooms[0]?.id ?? 0, start: hours?.open ?? 600, end: (hours?.open ?? 600) + 60 })} disabled={!rooms.length}>
          新規予約
        </Button>
        <span className="ml-auto text-sm font-semibold tabular-nums">
          {fmtDate(date)}{!hours && <span className="ml-2 text-red-700">定休日</span>}　{active.length}件
        </span>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-xs text-neutral-600 md:px-0" aria-label="区分の色">
        {CATEGORY_KEYS.map((k) => (
          <li key={k} className="flex items-center gap-1.5"><i className="h-3 w-1 rounded-xs" style={{ background: CATEGORIES[k].color }} />{CATEGORIES[k].label}</li>
        ))}
        <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-xs border border-dashed border-neutral-500" />仮予約</li>
        <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-xs bg-neutral-100" />営業時間外</li>
      </ul>
      {error && <div className="mx-4 mb-3 md:mx-0"><Notice>{error}</Notice></div>}

      <Timeline rows={tlRows} range={range} hours={hours} now={date === now.date ? now.min : null}
        scrollTo={{ key: date, minute: date === now.date ? now.min - 60 : (hours?.open ?? range.open) }}
        selection={editing && !editing.id && editing.date === date ? { roomId: editing.room_id, start: editing.start, end: editing.end } : null}
        onPick={(roomId, s) => open({ room_id: roomId, ...s })}
        onItem={(id) => { const r = rows.find((x) => x.id === id); if (r) setEditing(draftOf(r)); }} />
      <p className="px-4 pt-2 text-xs text-neutral-500 md:px-0">空いている時間を押すと1時間で新規予約（PC はドラッグで範囲指定）。予約を押すと編集。</p>

      {cancelled.length > 0 && (
        <div className="mt-6 px-4 md:px-0">
          <h3 className="border-b border-neutral-200 pb-2 text-sm font-bold">この日のキャンセル済み（{cancelled.length}件）</h3>
          <ul className="divide-y divide-neutral-200">
            {cancelled.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="tabular-nums text-neutral-500 line-through">{describe(r).time}</span>
                <span className="min-w-0 flex-1 truncate">{r.name}<span className="text-neutral-500">　{rooms.find((x) => x.id === r.room_id)?.name}　{CATEGORIES[r.category]?.label}</span></span>
                <Button className="h-9" onClick={() => setEditing(draftOf(r))}>開く</Button>
                <Button className="h-9" onClick={() => undo(r)}>取り消す</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <BookingEditor initial={editing} rooms={rooms} others={rows} hoursOf={hoursOf} closedOf={closedOf} range={range}
          onClose={() => setEditing(null)}
          onSaved={(d) => { setEditing(null); setDate(d); setReloadKey((k) => k + 1); }} />
      )}
    </div>
  );
}
