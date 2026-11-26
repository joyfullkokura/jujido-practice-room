"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, earliestBookable, fmtDate, nowJST, toISO } from "@/lib/date";
import { fmtLen, fmtMin, type Column, type Room, type Selection } from "@/lib/types";
import { busyList, endOptions, moveStart, startOptions, type Busy } from "@/lib/slots";
import { useShopCalendar } from "@/lib/useShopCalendar";
import { describe, explain, fetchReservations, fmtStamp, sourceLabel, type ReservationRow, type RoomRow } from "@/lib/admin";
import TimeGrid from "@/components/TimeGrid";
import BottomSheet from "@/components/BottomSheet";
import { Badge, Button, Field, Notice, inputCls } from "@/components/ui";

export default function DayTab({ rooms }: { rooms: RoomRow[] }) {
  const [now, setNow] = useState(nowJST);
  const [date, setDate] = useState(() => nowJST().date);
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [detail, setDetail] = useState<ReservationRow | null>(null);
  const [proxy, setProxy] = useState<{ col: Column; sel: Selection } | null>(null);
  const { hoursOf, closedOf, range } = useShopCalendar(date, date, reloadKey);

  useEffect(() => { const t = setInterval(() => setNow(nowJST()), 30_000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    const { data, error } = await fetchReservations(date, date);
    setError(error ? explain(error) : "");
    setRows(data ?? []);
  }, [date]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const confirmed = rows.filter((r) => r.status === "confirmed");
  const cancelled = rows.filter((r) => r.status === "cancelled");
  const columns: Column[] = rooms.map((r) => ({ key: `r${r.id}`, roomId: r.id, date }));

  const busyOf = useCallback((col: Column): Busy[] => busyList({
    booked: confirmed.filter((r) => r.room_id === col.roomId).map((r) => {
      const d = describe(r);
      return { start: d.start, end: d.end, id: r.id, title: r.name, sub: [r.school, d.time].filter(Boolean).join("・") };
    }),
    closed: closedOf(col.roomId, col.date),
    hours: hoursOf(col.date),
    earliest: earliestBookable(col.date, now),
  }), [confirmed, closedOf, hoursOf, now]);

  const setStatus = async (r: ReservationRow, status: "confirmed" | "cancelled") => {
    const { error } = await supabase.from("reservations").update({ status }).eq("id", r.id);
    if (error) return alert(explain(error));
    setDetail(null);
    setReloadKey((k) => k + 1);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 md:px-0">
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="日付"
          className={`${inputCls} w-auto tabular-nums`} />
        <Button onClick={() => setDate(nowJST().date)}>今日</Button>
        <div className="flex">
          <Button className="rounded-r-none px-3" aria-label="前の日" onClick={() => setDate((d) => addDays(d, -1))}>‹</Button>
          <Button className="-ml-px rounded-l-none px-3" aria-label="次の日" onClick={() => setDate((d) => addDays(d, 1))}>›</Button>
        </div>
        <span className="ml-auto text-sm font-semibold tabular-nums">{fmtDate(date)}　確定 {confirmed.length}件</span>
      </div>
      <p className="px-4 pb-3 text-xs text-neutral-500 md:px-0">予約を押すと詳細・キャンセル。空いている時間を押す（なぞる）と代理予約できます。</p>
      {error && <div className="mx-4 mb-3 md:mx-0"><Notice>{error}</Notice></div>}

      <TimeGrid columns={columns} rooms={rooms as Room[]} busyOf={busyOf} range={range} now={now} minColWidth="9rem"
        selection={proxy?.sel ?? null}
        onSelect={(col, r) => setProxy({ col, sel: { roomId: col.roomId, date: col.date, ...r } })}
        onBookedClick={(_c, b) => setDetail(rows.find((r) => r.id === b.id) ?? null)}
        header={(c) => {
          const room = rooms.find((r) => r.id === c.roomId);
          return (
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                <i className="size-2 shrink-0 rounded-xs" style={{ background: room?.color }} />
                <span className="truncate">{room?.name}</span>
              </p>
              {room && !room.is_public && <Badge>非公開</Badge>}
            </div>
          );
        }} />

      {cancelled.length > 0 && (
        <div className="mt-6 px-4 md:px-0">
          <h3 className="border-b border-neutral-200 pb-2 text-sm font-bold">この日のキャンセル済み（{cancelled.length}件）</h3>
          <ul className="divide-y divide-neutral-200">
            {cancelled.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="tabular-nums text-neutral-500 line-through">{describe(r).time}</span>
                <span className="min-w-0 flex-1 truncate">{r.name}<span className="text-neutral-500">　{rooms.find((x) => x.id === r.room_id)?.name}</span></span>
                <Button className="h-9" onClick={() => setStatus(r, "confirmed")}>取り消す</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail && (
        <BottomSheet onClose={() => setDetail(null)} label="予約の詳細">
          <Detail r={detail} rooms={rooms} onCancel={() => confirm(`${detail.name} さんの予約をキャンセルしますか？`) && setStatus(detail, "cancelled")} />
        </BottomSheet>
      )}
      {proxy && (
        <ProxySheet initial={proxy.sel} rooms={rooms} range={range}
          busyFor={(roomId) => busyOf({ key: `r${roomId}`, roomId, date: proxy.sel.date })}
          onChange={(sel) => setProxy({ ...proxy, sel })}
          onClose={() => setProxy(null)} onSaved={() => { setProxy(null); setReloadKey((k) => k + 1); }} />
      )}
    </div>
  );
}

function Detail({ r, rooms, onCancel }: { r: ReservationRow; rooms: RoomRow[]; onCancel: () => void }) {
  const d = describe(r);
  const rows: [string, string][] = [
    ["日付", fmtDate(d.date)], ["時間", `${d.time}（${fmtLen(d.end - d.start)}）`],
    ["部屋", rooms.find((x) => x.id === r.room_id)?.name ?? String(r.room_id)],
    ["名前", r.name], ["学校名", r.school ?? "—"], ["流入元", sourceLabel(r.source) || "—"],
    ["作成日時", fmtStamp(r.created_at)],
  ];
  return (
    <div className="pt-1">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold">{r.name}</h2>
        {r.status === "cancelled" ? <Badge tone="red">キャンセル済</Badge> : <Badge tone="accent">確定</Badge>}
      </div>
      <dl className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200">
        {rows.map(([k, v]) => (
          <div key={k} className="flex py-2.5"><dt className="w-20 shrink-0 text-sm text-neutral-500">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
        ))}
      </dl>
      {r.status === "confirmed" && <Button variant="danger" className="mt-6 w-full" onClick={onCancel}>この予約をキャンセルする</Button>}
    </div>
  );
}

/** 管理者による代理予約（電話・店頭で受けた予約） */
function ProxySheet({ initial, rooms, range, busyFor, onChange, onClose, onSaved }: {
  initial: Selection; rooms: RoomRow[]; range: { open: number; close: number };
  busyFor: (roomId: number) => Busy[]; onChange: (s: Selection) => void; onClose: () => void; onSaved: () => void;
}) {
  const sel = initial;
  const busy = useMemo(() => busyFor(sel.roomId), [busyFor, sel.roomId]);
  const starts = startOptions(busy, range), ends = endOptions(busy, sel.start, range);
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("名前を入力してください。");
    setSaving(true);
    const { error } = await supabase.from("reservations").insert({
      room_id: sel.roomId, start_at: toISO(sel.date, sel.start), end_at: toISO(sel.date, sel.end),
      name: name.trim(), school: school.trim() || null, source: "admin",
    });
    setSaving(false);
    if (error) return setError(explain(error));
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose} label="代理予約">
      <form onSubmit={save} className="space-y-4 pt-1">
        <div>
          <p className="text-sm font-semibold text-accent">代理予約（電話・店頭）</p>
          <h2 className="text-xl font-bold tabular-nums">{fmtDate(sel.date)}</h2>
        </div>
        <Field label="部屋">
          <select value={sel.roomId} className={inputCls} onChange={(e) => {
            const roomId = Number(e.target.value);
            const r = moveStart(busyFor(roomId), sel.start, sel.end - sel.start);
            onChange(r ? { ...sel, roomId, ...r } : { ...sel, roomId });
          }}>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.is_public ? "" : "（非公開）"}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="開始">
            <select aria-label="開始時刻" value={sel.start} className={`${inputCls} tabular-nums`} onChange={(e) => {
              const r = moveStart(busy, Number(e.target.value), sel.end - sel.start);
              if (r) onChange({ ...sel, ...r });
            }}>
              {starts.map((o) => <option key={o.m} value={o.m} disabled={!o.ok}>{fmtMin(o.m)}</option>)}
            </select>
          </Field>
          <Field label="終了">
            <select aria-label="終了時刻" value={sel.end} className={`${inputCls} tabular-nums`} onChange={(e) => onChange({ ...sel, end: Number(e.target.value) })}>
              {ends.map((o) => <option key={o.m} value={o.m} disabled={!o.ok}>{fmtMin(o.m)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="名前（必須）"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} className={inputCls} /></Field>
        <Field label="学校名"><input value={school} onChange={(e) => setSchool(e.target.value)} maxLength={50} className={inputCls} /></Field>
        {error && <Notice>{error}</Notice>}
        <Button type="submit" variant="primary" className="w-full" disabled={saving}>
          {saving ? "登録中…" : `${fmtMin(sel.start)}〜${fmtMin(sel.end)} で代理予約する`}
        </Button>
      </form>
    </BottomSheet>
  );
}
