"use client";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate, nowJST } from "@/lib/date";
import { fmtLen, fmtMin } from "@/lib/types";
import { explain, yen, type RoomRow } from "@/lib/admin";
import { Badge, Button, Field, Notice, SectionTitle, TimeSelect, inputCls } from "@/components/ui";

type Hit = { room_id: number; name: string; instruments: string | null; capacity: number | null; is_hall: boolean; is_public: boolean; total: number };
export type SearchPick = { date: string; room_id: number; start: number; end: number; people: number };

const LENGTHS = [30, 45, 60, 90, 120, 150, 180, 240, 300, 360];

/** 空き教室検索：日付・開始・時間・人数・設備で探し、料金（税込・一般貸出）を表示。そのまま予約へ */
export default function SearchTab({ rooms, onBook }: { rooms: RoomRow[]; onBook: (p: SearchPick) => void }) {
  const [date, setDate] = useState(() => nowJST().date);
  const [start, setStart] = useState(10 * 60);
  const [len, setLen] = useState(60);
  const [people, setPeople] = useState(1);
  const [kw, setKw] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 設備の候補：部屋の常設楽器（「、」区切り）から作る ＋ ホール
  const keywords = useMemo(() => {
    const set = new Set<string>();
    rooms.forEach((r) => (r.instruments ?? "").split(/[、,]/).map((s) => s.trim()).filter(Boolean).forEach((s) => set.add(s.split(" ")[0])));
    return [...set, ...(rooms.some((r) => r.is_hall) ? ["ホール"] : [])];
  }, [rooms]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    const { data, error } = await supabase.rpc("search_free_rooms", { p_date: date, p_start_min: start, p_minutes: len, p_people: Math.max(1, people), p_keyword: kw });
    setBusy(false);
    if (error) { setHits(null); return setError(explain(error)); }
    setHits(data as Hit[]);
  }

  return (
    <div className="space-y-4 px-4 py-4 md:px-0">
      <SectionTitle>空き教室検索</SectionTitle>
      <form onSubmit={search} className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(5,minmax(0,1fr))_auto] md:items-end">
        <Field label="希望日" className="col-span-2 md:col-span-1">
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={`${inputCls} tabular-nums`} />
        </Field>
        <Field label="開始"><TimeSelect label="開始" value={start} onChange={setStart} from={6 * 60} to={23 * 60} /></Field>
        <Field label="利用時間">
          <select aria-label="利用時間" value={len} onChange={(e) => setLen(Number(e.target.value))} className={inputCls}>
            {LENGTHS.map((m) => <option key={m} value={m}>{fmtLen(m)}</option>)}
          </select>
        </Field>
        <Field label="人数">
          <input aria-label="人数" type="number" min={1} max={200} inputMode="numeric" value={people} onChange={(e) => setPeople(Number(e.target.value))} className={`${inputCls} tabular-nums`} />
        </Field>
        <Field label="楽器・設備">
          <select aria-label="楽器・設備" value={kw} onChange={(e) => setKw(e.target.value)} className={inputCls}>
            <option value="">指定なし</option>
            {keywords.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Button type="submit" variant="primary" disabled={busy} className="col-span-2 md:col-span-1">{busy ? "検索中…" : "検索"}</Button>
      </form>
      {error && <Notice>{error}</Notice>}

      {hits && (
        <div>
          <p className="border-b border-neutral-200 pb-2 text-sm tabular-nums">
            {fmtDate(date)} {fmtMin(start)}〜{fmtMin(start + len)}（{fmtLen(len)}・{people}人）の空き：<b>{hits.length}室</b>
            <span className="ml-2 text-xs text-neutral-500">料金は一般貸出の税込</span>
          </p>
          <ul className="divide-y divide-neutral-200" aria-label="検索結果">
            {hits.map((h) => (
              <li key={h.room_id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">{h.name}{h.is_hall && <Badge>ホール</Badge>}{!h.is_public && <Badge>非公開</Badge>}</p>
                  <p className="truncate text-xs text-neutral-500">{h.instruments || "—"}{h.capacity ? `　定員 ${h.capacity}人` : ""}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{yen(h.total)}</span>
                <Button className="h-9" onClick={() => onBook({ date, room_id: h.room_id, start, end: start + len, people: Math.max(1, people) })}>予約へ</Button>
              </li>
            ))}
            {!hits.length && <li className="py-6 text-center text-sm text-neutral-500">該当する空き教室はありません</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
