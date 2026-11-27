"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { WEEKDAYS, nowJST, toISO, addDays } from "@/lib/date";
import { CATEGORIES, CATEGORY_KEYS } from "@/lib/booking";
import { explain, fetchReservations, yen, type ReservationRow, type RoomRow } from "@/lib/admin";
import { HEAT_HOURS, WINDOW, monthDays, monthStats, pct, ratio, shiftMonth, type MonthStats } from "@/lib/stats";
import type { ClosureRow, HoursRow } from "@/lib/useShopCalendar";
import { Button, Notice, SectionTitle, inputCls } from "@/components/ui";

const PLAN = "#a9bdf0";   // 予定（アクセントの薄い段）
const ACT = "#2f55c4";    // 実績（アクセント）
const fmtH = (min: number) => `${(min / 60).toFixed(min % 60 ? 1 : 0)}h`;

/** ダッシュボード・稼働率分析（印刷・PDF 保存対応） */
export default function DashboardTab({ rooms }: { rooms: RoomRow[] }) {
  const [month, setMonth] = useState(() => nowJST().date.slice(0, 7));
  const [data, setData] = useState<{ cur: MonthStats; prev: MonthStats; year: MonthStats } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const months = [month, shiftMonth(month, -1), shiftMonth(month, -12)];
      const first = monthDays(months[2])[0], last = monthDays(month).at(-1)!;
      const [h, c, ...rs] = await Promise.all([
        supabase.from("business_hours").select("weekday, open_time, close_time, is_closed"),
        supabase.from("closures").select("room_id, start_at, end_at").lt("start_at", toISO(addDays(last, 1), 0)).gt("end_at", toISO(first, 0)),
        ...months.map((m) => { const d = monthDays(m); return fetchReservations(d[0], d[d.length - 1]); }),
      ]);
      if (!live) return;
      const err = h.error ?? c.error ?? rs.find((x) => x.error)?.error ?? null;
      setError(err ? explain(err) : "");
      const calc = (m: string, rows: ReservationRow[] | null) => monthStats({ month: m, rows: rows ?? [], roomIds: rooms.map((r) => r.id),
        hours: (h.data as HoursRow[] | null) ?? null, closures: (c.data as ClosureRow[] | null) ?? [] });
      setData({ cur: calc(months[0], rs[0].data), prev: calc(months[1], rs[1].data), year: calc(months[2], rs[2].data) });
    })();
    return () => { live = false; };
  }, [month, rooms]);

  return (
    <div className="space-y-6 px-4 py-4 md:px-0">
      <div className="flex flex-wrap items-center gap-2" data-noprint>
        <input type="month" aria-label="月" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${inputCls} max-w-44 tabular-nums`} />
        <div className="flex">
          <Button className="rounded-r-none px-3" aria-label="前の月" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</Button>
          <Button className="-ml-px rounded-l-none px-3" aria-label="次の月" onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</Button>
        </div>
        <Button className="ml-auto" onClick={() => window.print()}>印刷・PDF 保存</Button>
      </div>
      <h2 className="hidden text-lg font-bold print:block">{month.replace("-", "年")}月 稼働・売上レポート</h2>
      {error && <Notice>{error}</Notice>}
      {data && <Body d={data} rooms={rooms} />}
    </div>
  );
}

function Body({ d, rooms }: { d: { cur: MonthStats; prev: MonthStats; year: MonthStats }; rooms: RoomRow[] }) {
  const { cur } = d;
  const T = cur.total;
  const rate = (s: MonthStats) => ratio(s.total.planned, s.total.avail);
  const cmp = (s: MonthStats) => {
    const a = rate(cur), b = rate(s);
    if (b == null || s.total.planned === 0) return "データなし";
    return `${pct(b)}（差 ${a == null ? "—" : `${((a - b) * 100 >= 0 ? "+" : "")}${((a - b) * 100).toFixed(1)}pt`}）`;
  };
  const catTotal = Object.entries(cur.catMin).reduce((a, [, v]) => a + v, 0);
  const roomOf = (id: number) => rooms.find((r) => r.id === id);
  const maxHeat = useMemo(() => Math.max(0.0001, ...cur.heat.flatMap((row, w) => row.map((v) => (cur.heatDays[w] ? v / (rooms.length * 60 * cur.heatDays[w]) : 0)))), [cur, rooms.length]);

  return (
    <>
      {/* 主な数字 */}
      <dl className="grid grid-cols-2 border-t border-l border-neutral-200 md:grid-cols-5" data-testid="kpi">
        <Tile label="稼働率（予定）" value={pct(rate(cur))} sub={`実績 ${pct(ratio(T.actual, T.avail))}`} />
        <Tile label="営業時間内 ／ 時間外" value={`${pct(ratio(T.plannedIn, T.availIn))}`} sub={`時間外 ${pct(ratio(T.planned - T.plannedIn, T.avail - T.availIn))}`} />
        <Tile label="利用時間 ／ 空き時間" value={fmtH(T.planned)} sub={`空き ${fmtH(Math.max(0, T.avail - T.planned))}`} />
        <Tile label={`貸出売上（税込）・${cur.revenue.count}件`} value={yen(cur.revenue.total)} />
        <Tile label="入金済 ／ 未収" value={yen(cur.revenue.paid)} sub={<span className="text-red-700">未収 {yen(cur.revenue.unpaid)}</span>} />
      </dl>
      <p className="text-sm tabular-nums">前月 {cmp(d.prev)}　／　前年同月 {cmp(d.year)}
        <span className="ml-2 text-xs text-neutral-500">稼働率（予定）の比較。分母は営業日の {WINDOW.open / 60}:00〜{WINDOW.close / 60}:00 × 部屋数（予約不可・メンテナンスを除く）</span>
      </p>

      {/* 部屋別 */}
      <section>
        <SectionTitle right={<Legend items={[["予定", PLAN], ["実績（利用済み）", ACT], ["目標", "#171717"]]} />}>部屋別の稼働率と目標</SectionTitle>
        <ul className="divide-y divide-neutral-200" aria-label="部屋別の稼働率">
          {cur.rooms.map((s) => {
            const r = roomOf(s.roomId);
            const p = ratio(s.planned, s.avail), a = ratio(s.actual, s.avail), goal = (r?.target_rate ?? 0) / 100;
            return (
              <li key={s.roomId} className="grid grid-cols-[6rem_1fr] items-center gap-x-3 gap-y-1 py-2.5 md:grid-cols-[9rem_1fr_17rem]">
                <span className="truncate text-sm font-semibold">{r?.name}</span>
                <div className="relative space-y-1 py-1" title={`予定 ${pct(p)} ／ 実績 ${pct(a)} ／ 目標 ${r?.target_rate}%`}>
                  <Bar v={p} color={PLAN} /><Bar v={a} color={ACT} />
                  {goal > 0 && <i className="absolute inset-y-0 w-0.5 bg-neutral-900" style={{ left: `${Math.min(100, goal * 100)}%` }} />}
                </div>
                <p className="col-span-2 text-xs text-neutral-600 tabular-nums md:col-span-1">
                  予定 {pct(p)}・実績 {pct(a)}・目標 {r?.target_rate}% → 達成率 {p == null || !goal ? "—" : `${Math.round((p / goal) * 100)}%`}
                  <br />売上 {yen(s.revenue)}{r?.sales_target ? `（目標 ${yen(r.sales_target)}・${Math.round((s.revenue / r.sales_target) * 100)}%）` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        {/* 区分別 */}
        <section>
          <SectionTitle>区分別の利用時間</SectionTitle>
          <ul className="divide-y divide-neutral-200" aria-label="区分別の利用時間">
            {CATEGORY_KEYS.filter((k) => k !== "maint").map((k) => {
              const m = cur.catMin[k] ?? 0;
              return (
                <li key={k} className="grid grid-cols-[9rem_1fr_6.5rem] items-center gap-3 py-2 text-sm">
                  <span className="flex items-center gap-1.5 truncate"><i className="h-3 w-1 shrink-0 rounded-xs" style={{ background: CATEGORIES[k].color }} />{CATEGORIES[k].label}</span>
                  <Bar v={ratio(m, catTotal)} color={CATEGORIES[k].color} />
                  <span className="text-right text-xs tabular-nums text-neutral-600">{fmtH(m)}（{pct(ratio(m, catTotal), 0)}）</span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 売上ランキング */}
        <section>
          <SectionTitle>貸出売上ランキング</SectionTitle>
          <ol className="divide-y divide-neutral-200 text-sm tabular-nums" aria-label="貸出売上ランキング">
            {[...cur.rooms].sort((a, b) => b.revenue - a.revenue).map((s, i) => (
              <li key={s.roomId} className="flex items-center gap-3 py-2">
                <span className="w-5 text-right text-neutral-500">{i + 1}</span>
                <span className="flex-1 truncate font-semibold">{roomOf(s.roomId)?.name}</span>
                <span>{yen(s.revenue)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* ヒートマップ */}
      <section className="break-inside-avoid">
        <SectionTitle right={<span className="text-xs text-neutral-500">数字は稼働率（%）。濃いほど使われている</span>}>曜日 × 時間帯</SectionTitle>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[34rem] table-fixed border-separate border-spacing-0.5 text-center text-[11px] tabular-nums" aria-label="曜日×時間帯の稼働率">
            <thead><tr><th className="w-8" />{HEAT_HOURS.map((h) => <th key={h} className="font-normal text-neutral-500">{h}</th>)}</tr></thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 0].map((w) => (
                <tr key={w}>
                  <th className="font-semibold">{WEEKDAYS[w]}</th>
                  {cur.heat[w].map((v, i) => {
                    const n = cur.heatDays[w];
                    const p = n ? v / (rooms.length * 60 * n) : null;
                    const k = p == null ? 0 : p / maxHeat;
                    return (
                      <td key={i} title={`${WEEKDAYS[w]}曜 ${HEAT_HOURS[i]}時台：${p == null ? "営業日なし" : pct(p)}`}
                        className="h-7 rounded-xs" style={{ background: p == null ? "#f5f5f5" : `rgba(47,85,196,${(0.06 + k * 0.84).toFixed(2)})`, color: k > 0.55 ? "#fff" : "#404040" }}>
                        {p == null ? "" : Math.round(p * 100)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 流入元・学校 */}
      <div className="grid gap-6 md:grid-cols-2">
        <CountList title="流入元別の予約件数" rows={cur.sources} />
        <CountList title="学校別の予約件数" rows={cur.schools} empty="学校名の入った予約はありません" />
      </div>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="border-r border-b border-neutral-200 p-3">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-neutral-600 tabular-nums">{sub}</dd>}
    </div>
  );
}
function Bar({ v, color }: { v: number | null; color: string }) {
  return (
    <div className="h-2 bg-neutral-100">
      <div className="h-2 rounded-r-xs" style={{ width: `${Math.min(100, (v ?? 0) * 100)}%`, background: color }} />
    </div>
  );
}
function Legend({ items }: { items: [string, string][] }) {
  return (
    <ul className="flex gap-3 text-xs text-neutral-600">
      {items.map(([l, c]) => <li key={l} className="flex items-center gap-1"><i className="h-2 w-3" style={{ background: c }} />{l}</li>)}
    </ul>
  );
}
function CountList({ title, rows, empty = "ありません" }: { title: string; rows: [string, number][]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <ul className="divide-y divide-neutral-200 text-sm tabular-nums" aria-label={title}>
        {rows.slice(0, 15).map(([k, n]) => (
          <li key={k} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 py-1.5">
            <span className="truncate">{k}</span>
            <div className="h-2 bg-neutral-100"><div className="h-2 bg-neutral-500" style={{ width: `${(n / max) * 100}%` }} /></div>
            <span className="text-right">{n}件</span>
          </li>
        ))}
        {!rows.length && <li className="py-4 text-center text-neutral-500">{empty}</li>}
      </ul>
    </section>
  );
}
