"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, fmtDate, nowJST, yearNum } from "@/lib/date";
import { CATEGORIES, STATUSES, isActive } from "@/lib/booking";
import { describe, explain, fetchReservations, type ReservationRow, type RoomRow } from "@/lib/admin";
import { Button, Notice, inputCls } from "@/components/ui";

/** レポート：その日の教室利用予定表（印刷用） */
export default function ReportTab({ rooms }: { rooms: RoomRow[] }) {
  const [date, setDate] = useState(() => nowJST().date);
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await fetchReservations(date, date);
    setError(error ? explain(error) : "");
    setRows((data ?? []).filter(isActive));
  }, [date]);
  useEffect(() => { setInfo(""); load(); }, [load]);

  const order = (id: number) => rooms.findIndex((r) => r.id === id);
  const list = [...rows].sort((a, b) => a.start_at.localeCompare(b.start_at) || order(a.room_id) - order(b.room_id));
  const confirmed = rows.filter((r) => r.status === "confirmed");

  async function markUsed() {
    if (!confirm(`${fmtDate(date)} の「確定」の予約 ${confirmed.length}件 をすべて「利用済み」にしますか？`)) return;
    const { error } = await supabase.from("reservations").update({ status: "used" }).in("id", confirmed.map((r) => r.id));
    if (error) return setError(explain(error));
    setInfo(`${confirmed.length}件を利用済みにしました。`);
    load();
  }

  return (
    <div className="space-y-4 px-4 py-4 md:px-0">
      <div className="flex flex-wrap items-center gap-2" data-noprint>
        <input type="date" aria-label="日付" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputCls} max-w-44 tabular-nums`} />
        <div className="flex">
          <Button className="rounded-r-none px-3" aria-label="前の日" onClick={() => setDate((d) => addDays(d, -1))}>‹</Button>
          <Button className="-ml-px rounded-l-none px-3" aria-label="次の日" onClick={() => setDate((d) => addDays(d, 1))}>›</Button>
        </div>
        <Button onClick={markUsed} disabled={!confirmed.length}>この日の確定をすべて利用済みにする</Button>
        <Button variant="primary" className="ml-auto" onClick={() => window.print()}>印刷・PDF 保存</Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {info && <div data-noprint><Notice tone="info">{info}</Notice></div>}

      <h2 className="border-b-2 border-neutral-900 pb-2 text-lg font-bold tabular-nums">{yearNum(date)}年{fmtDate(date)} 教室利用予定表<span className="ml-3 text-sm font-normal">{list.length}件</span></h2>
      <table className="w-full text-sm tabular-nums" aria-label="教室利用予定表">
        <thead>
          <tr className="border-b border-neutral-300 text-left text-xs text-neutral-600">
            {["時間", "部屋", "区分", "利用者", "講師", "人数", "状況", "備考"].map((h) => <th key={h} className="py-1.5 pr-3 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {list.map((r) => (
            <tr key={r.id} className="break-inside-avoid">
              <td className="py-1.5 pr-3 whitespace-nowrap">{describe(r).time}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{rooms.find((x) => x.id === r.room_id)?.name}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{CATEGORIES[r.category]?.label}</td>
              <td className="py-1.5 pr-3 font-semibold">{r.name}</td>
              <td className="py-1.5 pr-3">{r.teacher}</td>
              <td className="py-1.5 pr-3">{r.people}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{STATUSES[r.status]}</td>
              <td className="py-1.5 text-xs text-neutral-600">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && <p className="py-6 text-center text-sm text-neutral-500">この日の予約はありません</p>}
    </div>
  );
}
