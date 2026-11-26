"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, fmtDate, fromISO, nowJST, toISO } from "@/lib/date";
import { fmtMin } from "@/lib/types";
import { explain, type RoomRow } from "@/lib/admin";
import type { ClosureRow } from "@/lib/useShopCalendar";
import { Button, Field, Notice, SectionTitle, TimeSelect, inputCls } from "@/components/ui";

const REASONS = ["定休日", "店の都合", "メンテナンス"];

export default function ClosuresTab({ rooms }: { rooms: RoomRow[] }) {
  const today = nowJST().date;
  const [list, setList] = useState<Required<ClosureRow>[]>([]);
  const [room, setRoom] = useState<number | "all">("all");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [startMin, setStartMin] = useState(10 * 60);
  const [endMin, setEndMin] = useState(21 * 60);
  const [reason, setReason] = useState("店の都合");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("closures").select("id, room_id, start_at, end_at, reason")
      .gt("end_at", new Date().toISOString()).order("start_at");
    if (error) setError(explain(error));
    setList((data ?? []) as Required<ClosureRow>[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setInfo("");
    const start_at = allDay ? toISO(startDate, 0) : toISO(startDate, startMin);
    const end_at = allDay ? toISO(addDays(endDate, 1), 0) : toISO(endDate, endMin);
    if (Date.parse(end_at) <= Date.parse(start_at)) return setError("終了は開始より後にしてください。");
    setSaving(true);
    const { error } = await supabase.from("closures").insert({ room_id: room === "all" ? null : room, start_at, end_at, reason: reason.trim() || null });
    setSaving(false);
    if (error) return setError(explain(error));
    // すでに入っている予約は自動でキャンセルしない。件数だけ知らせる
    let q = supabase.from("reservations").select("id", { count: "exact", head: true })
      .eq("status", "confirmed").lt("start_at", end_at).gt("end_at", start_at);
    if (room !== "all") q = q.eq("room_id", room);
    const { count } = await q;
    setInfo(count ? `登録しました。この時間にはすでに予約が ${count} 件あります（自動ではキャンセルされません。「一覧」から確認してください）。` : "登録しました。");
    load();
  }

  async function remove(c: Required<ClosureRow>) {
    if (!confirm("この予約不可枠を削除しますか？")) return;
    const { error } = await supabase.from("closures").delete().eq("id", c.id);
    if (error) return setError(explain(error));
    load();
  }

  const label = (c: Required<ClosureRow>) => {
    const s = fromISO(c.start_at), e = fromISO(c.end_at);
    const allDayRange = s.min === 0 && e.min === 0;
    if (allDayRange) {
      const last = addDays(e.date, -1);
      return last === s.date ? `${fmtDate(s.date)} 終日` : `${fmtDate(s.date)}〜${fmtDate(last)} 終日`;
    }
    return s.date === e.date ? `${fmtDate(s.date)} ${fmtMin(s.min)}〜${fmtMin(e.min)}` : `${fmtDate(s.date)} ${fmtMin(s.min)}〜${fmtDate(e.date)} ${fmtMin(e.min)}`;
  };

  return (
    <div className="space-y-8 px-4 py-4 md:px-0">
      <section>
        <SectionTitle>予約不可枠を追加</SectionTitle>
        <p className="mt-2 text-xs text-neutral-500">毎週の定休日は「営業時間」タブで設定します。ここでは臨時の休み・店の都合・メンテナンスを登録します。理由は利用者の画面にも表示されます。</p>
        <form onSubmit={add} className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="部屋">
            <select value={room} onChange={(e) => setRoom(e.target.value === "all" ? "all" : Number(e.target.value))} className={inputCls}>
              <option value="all">全部屋</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="理由（利用者にも表示）">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={40} className={inputCls} list="closure-reasons" />
            <datalist id="closure-reasons">{REASONS.map((r) => <option key={r} value={r} />)}</datalist>
            <span className="mt-2 flex gap-2">
              {REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)}
                  className={`h-8 rounded-sm border px-2.5 text-xs ${reason === r ? "border-accent bg-accent-soft text-accent" : "border-neutral-300 text-neutral-700"}`}>{r}</button>
              ))}
            </span>
          </Field>
          <Field label="開始日"><input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} className={inputCls} /></Field>
          <Field label="終了日"><input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} /></Field>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-5 accent-[#2f55c4]" />
            終日
          </label>
          {!allDay && (
            <>
              <Field label="開始時刻"><TimeSelect label="予約不可の開始時刻" value={startMin} onChange={setStartMin} /></Field>
              <Field label="終了時刻"><TimeSelect label="予約不可の終了時刻" value={endMin} onChange={setEndMin} /></Field>
            </>
          )}
          <div className="space-y-3 md:col-span-2">
            {error && <Notice>{error}</Notice>}
            {info && <Notice tone="info">{info}</Notice>}
            <Button type="submit" variant="primary" disabled={saving} className="w-full md:w-auto">{saving ? "登録中…" : "追加する"}</Button>
          </div>
        </form>
      </section>

      <section>
        <SectionTitle>登録済み（これから）</SectionTitle>
        <ul className="divide-y divide-neutral-200">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tabular-nums">{label(c)}</p>
                <p className="text-xs text-neutral-500">{c.room_id == null ? "全部屋" : rooms.find((r) => r.id === c.room_id)?.name}　{c.reason}</p>
              </div>
              <Button variant="danger" className="h-9" onClick={() => remove(c)}>削除</Button>
            </li>
          ))}
          {!list.length && <li className="py-6 text-center text-sm text-neutral-500">ありません</li>}
        </ul>
      </section>
    </div>
  );
}
