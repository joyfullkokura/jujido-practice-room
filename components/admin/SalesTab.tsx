"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate, nowJST } from "@/lib/date";
import { PAYMENTS, PAYMENT_KEYS, type Payment } from "@/lib/booking";
import { describe, download, explain, fetchReservations, toCSV, yen, type ReservationRow, type RoomRow } from "@/lib/admin";
import { monthDays, shiftMonth } from "@/lib/stats";
import { Button, Notice, inputCls } from "@/components/ui";

/** 売上管理：月ごとの一般貸出の売上一覧。支払状況の変更、未払いは赤 */
export default function SalesTab({ rooms }: { rooms: RoomRow[] }) {
  const [month, setMonth] = useState(() => nowJST().date.slice(0, 7));
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [error, setError] = useState("");
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);

  const load = useCallback(async () => {
    const days = monthDays(month);
    const { data, error } = await fetchReservations(days[0], days[days.length - 1]);
    setError(error ? explain(error) : "");
    setRows(data ?? []);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const sales = useMemo(() => rows.filter((r) => r.category === "rental" && r.status !== "cancelled"), [rows]);
  const shown = onlyUnpaid ? sales.filter((r) => r.payment === "unpaid") : sales;
  const sum = (xs: ReservationRow[]) => xs.reduce((a, r) => a + r.price_total, 0);
  const roomName = (id: number) => rooms.find((x) => x.id === id)?.name ?? String(id);

  async function setPayment(r: ReservationRow, payment: Payment) {
    const { error } = await supabase.from("reservations").update({ payment }).eq("id", r.id);
    if (error) return setError(explain(error));
    setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, payment } : x)));
  }

  return (
    <div className="space-y-4 px-4 py-4 md:px-0">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" aria-label="月" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${inputCls} max-w-44 tabular-nums`} />
        <div className="flex">
          <Button className="rounded-r-none px-3" aria-label="前の月" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</Button>
          <Button className="-ml-px rounded-l-none px-3" aria-label="次の月" onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyUnpaid} onChange={(e) => setOnlyUnpaid(e.target.checked)} className="size-5 accent-[#2f55c4]" />未払いだけ
        </label>
        <Button className="ml-auto" onClick={() => download(`reservations_${month}.csv`, toCSV(rows, rooms))} disabled={!rows.length}>CSV（この月の全予約）</Button>
      </div>
      {error && <Notice>{error}</Notice>}

      <dl className="grid grid-cols-3 divide-x divide-neutral-200 border-y border-neutral-200 tabular-nums">
        <div className="py-3 pr-3"><dt className="text-xs text-neutral-500">貸出売上（税込）・{sales.length}件</dt><dd className="text-xl font-bold">{yen(sum(sales))}</dd></div>
        <div className="p-3"><dt className="text-xs text-neutral-500">入金済</dt><dd className="text-xl font-bold">{yen(sum(sales.filter((r) => r.payment === "paid")))}</dd></div>
        <div className="p-3"><dt className="text-xs text-neutral-500">未収</dt><dd className="text-xl font-bold text-red-700">{yen(sum(sales.filter((r) => r.payment === "unpaid")))}</dd></div>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm tabular-nums">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              {["日付", "時間", "部屋", "利用者", "人数", "税抜", "税込", "支払"].map((h) => <th key={h} className="py-2 pr-3 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {shown.map((r) => {
              const d = describe(r);
              const unpaid = r.payment === "unpaid";
              return (
                <tr key={r.id} data-unpaid={unpaid || undefined}>
                  <td className="py-2 pr-3">{fmtDate(d.date)}</td>
                  <td className="py-2 pr-3">{d.time}</td>
                  <td className="py-2 pr-3">{roomName(r.room_id)}</td>
                  <td className="py-2 pr-3 font-semibold">{r.name}</td>
                  <td className="py-2 pr-3">{r.people}</td>
                  <td className="py-2 pr-3 text-right">{yen(r.price_net)}</td>
                  <td className="py-2 pr-3 text-right font-semibold">{yen(r.price_total)}</td>
                  <td className="py-1.5">
                    <select aria-label={`${r.name} の支払状況`} value={r.payment} onChange={(e) => setPayment(r, e.target.value as Payment)}
                      className={`h-9 rounded-sm border bg-white px-2 text-sm ${unpaid ? "border-red-300 font-semibold text-red-700" : "border-neutral-300"}`}>
                      {PAYMENT_KEYS.map((k) => <option key={k} value={k}>{PAYMENTS[k]}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-neutral-300 font-bold">
                <td className="py-2 pr-3" colSpan={5}>合計（{shown.length}件）</td>
                <td className="py-2 pr-3 text-right">{yen(shown.reduce((a, r) => a + r.price_net, 0))}</td>
                <td className="py-2 pr-3 text-right">{yen(sum(shown))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!shown.length && !error && <p className="py-8 text-center text-sm text-neutral-500">この月の貸出売上はありません</p>}
    </div>
  );
}
