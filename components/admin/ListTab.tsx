"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, fmtDate, nowJST } from "@/lib/date";
import { describe, download, explain, fetchReservations, fmtStamp, sourceLabel, toCSV, type ReservationRow, type RoomRow } from "@/lib/admin";
import { Badge, Button, Field, Notice, inputCls } from "@/components/ui";

type Status = "all" | "confirmed" | "cancelled";

export default function ListTab({ rooms }: { rooms: RoomRow[] }) {
  const today = nowJST().date;
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 30));
  const [status, setStatus] = useState<Status>("all");
  const [room, setRoom] = useState<number | "all">("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!from || !to) return;
    const { data, error } = await fetchReservations(from, to);
    setError(error ? explain(error) : "");
    setRows(data ?? []);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => rows.filter((r) =>
    (status === "all" || r.status === status) &&
    (room === "all" || r.room_id === room) &&
    (!q || `${r.name} ${r.school ?? ""} ${r.source ?? ""}`.includes(q.trim()))), [rows, status, room, q]);
  const roomName = (id: number) => rooms.find((x) => x.id === id)?.name ?? String(id);

  const setRowStatus = async (r: ReservationRow, s: "confirmed" | "cancelled") => {
    if (s === "cancelled" && !confirm(`${r.name} さんの予約をキャンセルしますか？`)) return;
    const { error } = await supabase.from("reservations").update({ status: s }).eq("id", r.id);
    if (error) return alert(explain(error));
    load();
  };

  return (
    <div className="px-4 py-4 md:px-0">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.5fr)]">
        <Field label="開始日"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
        <Field label="終了日"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
        <Field label="状態">
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={inputCls}>
            <option value="all">すべて</option><option value="confirmed">確定</option><option value="cancelled">キャンセル</option>
          </select>
        </Field>
        <Field label="部屋">
          <select value={room} onChange={(e) => setRoom(e.target.value === "all" ? "all" : Number(e.target.value))} className={inputCls}>
            <option value="all">すべて</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="名前・学校・流入元で検索" className="col-span-2 md:col-span-1">
          <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} placeholder="例：○○中" />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-b border-neutral-200 pb-3">
        <p className="mr-auto text-sm tabular-nums">
          {shown.length}件<span className="ml-2 text-neutral-500">（確定 {shown.filter((r) => r.status === "confirmed").length} ／ キャンセル {shown.filter((r) => r.status === "cancelled").length}）</span>
        </p>
        <Button onClick={() => download(`reservations_${from}_${to}.csv`, toCSV(shown, rooms))} disabled={!shown.length}>CSV ダウンロード</Button>
      </div>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}

      {/* スマホ：カード */}
      <ul className="divide-y divide-neutral-200 md:hidden">
        {shown.map((r) => {
          const d = describe(r);
          return (
            <li key={r.id} className="py-3">
              <div className="flex items-center gap-2 text-sm tabular-nums">
                <span className={`font-semibold ${r.status === "cancelled" ? "text-neutral-400 line-through" : ""}`}>{fmtDate(d.date)} {d.time}</span>
                {r.status === "cancelled" && <Badge tone="red">キャンセル</Badge>}
              </div>
              <p className="mt-0.5 text-base font-semibold">{r.name}<span className="ml-2 text-sm font-normal text-neutral-600">{r.school}</span></p>
              <p className="mt-0.5 text-xs text-neutral-500">{roomName(r.room_id)}　流入元: {sourceLabel(r.source) || "—"}　作成: {fmtStamp(r.created_at)}</p>
              <div className="mt-2">
                {r.status === "confirmed"
                  ? <Button variant="danger" className="h-9" onClick={() => setRowStatus(r, "cancelled")}>キャンセル</Button>
                  : <Button className="h-9" onClick={() => setRowStatus(r, "confirmed")}>キャンセルを取り消す</Button>}
              </div>
            </li>
          );
        })}
      </ul>

      {/* PC：表 */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            {["日付", "時間", "部屋", "名前", "学校名", "流入元", "作成日時", "状態", ""].map((h) => <th key={h} className="py-2 pr-3 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {shown.map((r) => {
            const d = describe(r);
            const off = r.status === "cancelled" ? "text-neutral-400" : "";
            return (
              <tr key={r.id} className={off}>
                <td className="py-2 pr-3 tabular-nums">{fmtDate(d.date)}</td>
                <td className="py-2 pr-3 tabular-nums">{d.time}</td>
                <td className="py-2 pr-3">{roomName(r.room_id)}</td>
                <td className="py-2 pr-3 font-semibold">{r.name}</td>
                <td className="py-2 pr-3">{r.school}</td>
                <td className="py-2 pr-3">{sourceLabel(r.source)}</td>
                <td className="py-2 pr-3 tabular-nums text-neutral-500">{fmtStamp(r.created_at)}</td>
                <td className="py-2 pr-3">{r.status === "cancelled" ? <Badge tone="red">キャンセル</Badge> : <Badge tone="accent">確定</Badge>}</td>
                <td className="py-2 text-right">
                  {r.status === "confirmed"
                    ? <Button variant="danger" className="h-8 px-3" onClick={() => setRowStatus(r, "cancelled")}>キャンセル</Button>
                    : <Button className="h-8 px-3" onClick={() => setRowStatus(r, "confirmed")}>取り消す</Button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!shown.length && !error && <p className="py-8 text-center text-sm text-neutral-500">該当する予約はありません</p>}
    </div>
  );
}
