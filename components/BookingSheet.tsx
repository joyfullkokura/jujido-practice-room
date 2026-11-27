"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate, toISO } from "@/lib/date";
import { fmtLen, fmtMin, type Room, type Selection } from "@/lib/types";
import { STEP, endOptions, maxEnd, moveStart, startOptions, type Busy } from "@/lib/slots";
import BottomSheet from "@/components/BottomSheet";

type Props = {
  selection: Selection;
  /** その部屋・その日の「予約できない時間帯」 */
  busy: Busy[];
  range: { open: number; close: number };
  room: Room;
  source: string | null;
  onChange: (sel: Selection) => void;
  onClose: () => void;
  onBooked: () => void;
};

const input = "h-12 w-full rounded-sm border border-neutral-300 bg-white px-3 text-[17px] outline-none placeholder:text-neutral-400 focus:border-accent focus:ring-1 focus:ring-accent";
const labelCls = "mb-1.5 block text-sm font-semibold text-neutral-700";
const PRESETS = [30, 60, 90, 120, 180];

export default function BookingSheet({ selection, busy, range, room, source, onChange, onClose, onBooked }: Props) {
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [people, setPeople] = useState(1);
  const maxPeople = room.capacity ?? 10;
  const [done, setDone] = useState<{ sel: Selection; room: Room; price: number | null; people: number } | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const { start, end } = selection;
  const len = end - start;

  const starts = startOptions(busy, range);
  const ends = endOptions(busy, start, range);
  const okStart = (m: number) => starts.some((o) => o.m === m && o.ok);
  const okEnd = (m: number) => ends.some((o) => o.m === m && o.ok);
  /** 開始を変える（終了は「開始の30分後〜3時間後、かつ次の予約の直前まで」に自動で収める） */
  const setStart = (m: number) => { const r = moveStart(busy, m, len); if (r) onChange({ ...selection, ...r }); };
  /** − / ＋ はちょうど15分ずつ（ほかの予約を飛び越えない） */
  const prevS = okStart(start - STEP) ? start - STEP : null;
  const nextS = okStart(start + STEP) ? start + STEP : null;

  useEffect(() => setError(""), [selection.date, start, end, selection.roomId]);

  // 料金（税込）：有料の設定のときだけ DB の public_quote が金額を返す。無料・取得できないときは表示しない
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("public_quote", {
        p_room_id: selection.roomId, p_start_at: toISO(selection.date, start), p_end_at: toISO(selection.date, end), p_people: people });
      if (live) setPrice(!error && typeof data === "number" ? data : null);
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [selection.roomId, selection.date, start, end, people]);
  // 部屋の定員より多ければ定員に
  useEffect(() => setPeople((n) => Math.min(n, maxPeople)), [maxPeople]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("名前を入力してください");
    setSending(true);
    setError("");
    const { error } = await supabase.rpc("create_reservation", {
      p_room_id: selection.roomId,
      p_start_at: toISO(selection.date, start), p_end_at: toISO(selection.date, end),
      p_name: name, p_school: school, p_source: source, p_people: people,
    });
    setSending(false);
    if (!error) {
      // 完了画面の料金は、予約した内容で取り直す（人数・時間を変えた直後でも古い金額を出さない）
      const q = await supabase.rpc("public_quote", {
        p_room_id: selection.roomId, p_start_at: toISO(selection.date, start), p_end_at: toISO(selection.date, end), p_people: people });
      setDone({ sel: selection, room, price: !q.error && typeof q.data === "number" ? q.data : null, people });
      onBooked();
      return;
    }
    if (error.code === "23P01" || error.code === "23505") setError("選んだ時間に、ちょうど別の予約が入りました。別の時間を選んでください。");
    else if (error.code === "23514") setError("名前と学校名は50文字以内で入力してください。");
    else if (error.code === "P0001") setError(error.message);
    else setError("予約できませんでした。通信状況を確認して、もう一度お試しください。");
  }

  return (
    <BottomSheet onClose={onClose} label="予約フォーム">
      {done ? (
        <div className="pt-2">
          <p className="text-sm font-semibold text-accent">予約が完了しました</p>
          <h2 className="mt-1 text-xl font-bold">ご予約内容</h2>
          <dl className="mt-4 divide-y divide-neutral-200 border-y border-neutral-200 text-[17px]">
            <Row k="日付" v={fmtDate(done.sel.date)} />
            <Row k="時間" v={`${fmtMin(done.sel.start)}〜${fmtMin(done.sel.end)}（${fmtLen(done.sel.end - done.sel.start)}）`} />
            <Row k="部屋" v={done.room.name} />
            <Row k="人数" v={`${done.people}人`} />
            {done.price != null && <Row k="料金" v={`${yen(done.price)}（税込）`} />}
          </dl>
          <button onClick={onClose} className="mt-6 h-12 w-full rounded-sm border border-neutral-300 text-base font-semibold text-neutral-800 active:bg-neutral-100">
            閉じる
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="pt-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-bold tabular-nums">{fmtDate(selection.date)}</h2>
            <button type="button" onClick={onClose} className="text-sm text-neutral-500">閉じる</button>
          </div>
          <p className="mt-1 flex items-center gap-2 text-[15px] text-neutral-700">
            <i className="size-2 rounded-xs" style={{ background: room.color }} />{room.name}
            {room.capacity ? <span className="text-sm text-neutral-500">定員 {room.capacity}人</span> : null}
          </p>
          {room.instruments && <p className="mt-1 text-sm text-neutral-500">{room.instruments}</p>}
          {room.description && <p className="mt-1 text-sm text-neutral-500">{room.description}</p>}

          {/* 時間：リストから直接選ぶ／− ＋ で15分ずつ */}
          <div className="mt-5">
            <span className={labelCls}>時間<span className="ml-2 text-xs font-normal text-neutral-500 tabular-nums">{fmtLen(len)}</span></span>
            <div className="divide-y divide-neutral-200 rounded-sm border border-neutral-300">
              <TimeRow label="開始" value={start} options={starts} onSelect={setStart}
                onMinus={() => prevS != null && setStart(prevS)} minusOk={prevS != null}
                onPlus={() => nextS != null && setStart(nextS)} plusOk={nextS != null} />
              <TimeRow label="終了" value={end} options={ends} onSelect={(m) => onChange({ ...selection, end: m })}
                onMinus={() => onChange({ ...selection, end: end - STEP })} minusOk={okEnd(end - STEP)}
                onPlus={() => onChange({ ...selection, end: end + STEP })} plusOk={okEnd(end + STEP)} />
            </div>
            <div className="mt-2 grid grid-cols-5 gap-px overflow-hidden rounded-sm border border-neutral-300 bg-neutral-300">
              {PRESETS.map((p) => {
                const ok = okEnd(start + p), active = len === p;
                return (
                  <button key={p} type="button" disabled={!ok} aria-pressed={active}
                    onClick={() => onChange({ ...selection, end: start + p })}
                    className={`h-10 text-sm tabular-nums ${active ? "bg-accent-soft font-semibold text-accent" : ok ? "bg-white text-neutral-700" : "bg-neutral-50 text-neutral-300"}`}>
                    {p < 60 ? `${p}分` : `${p / 60}時間`}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-neutral-500 tabular-nums">
              この開始時刻なら {fmtMin(maxEnd(busy, start))} まで延ばせます
            </p>
          </div>

          <label className="mt-5 block">
            <span className={labelCls}>人数{room.capacity ? <span className="ml-2 text-xs font-normal text-neutral-500">定員 {room.capacity}人</span> : null}</span>
            <select aria-label="人数" value={people} onChange={(e) => setPeople(Number(e.target.value))} className={`${input} tabular-nums`}>
              {Array.from({ length: maxPeople }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}人</option>)}
            </select>
          </label>

          <label className="mt-4 block">
            <span className={labelCls}>名前<span className="ml-1 text-xs font-normal text-red-600">必須</span></span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoComplete="name"
              className={input} placeholder="十字 太郎" />
          </label>
          <label className="mt-4 block">
            <span className={labelCls}>学校名</span>
            <input value={school} onChange={(e) => setSchool(e.target.value)} maxLength={50}
              className={input} placeholder="○○中学校" />
          </label>

          {price != null && (
            <p className="mt-5 flex items-baseline justify-between border-y border-neutral-200 py-3" data-testid="public-price">
              <span className="text-sm text-neutral-600">料金（税込）</span>
              <span className="text-xl font-bold tabular-nums">{yen(price)}</span>
            </p>
          )}

          {error && <p className="mt-4 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-[15px] text-red-800" role="alert">{error}</p>}

          <button type="submit" disabled={sending}
            className="mt-6 h-12 w-full rounded-sm bg-accent text-base font-semibold text-white tabular-nums active:bg-[#2647a8] disabled:opacity-60">
            {sending ? "予約しています…" : `${fmtMin(start)}〜${fmtMin(end)}（${fmtLen(len)}）で予約する`}
          </button>
        </form>
      )}
    </BottomSheet>
  );
}

/** 開始／終了の1行：− [時刻リスト] ＋ 。選べない時刻はグレー（disabled） */
function TimeRow({ label, value, options, onSelect, onMinus, onPlus, minusOk, plusOk }: {
  label: string; value: number; options: { m: number; ok: boolean }[]; onSelect: (m: number) => void;
  onMinus: () => void; onPlus: () => void; minusOk: boolean; plusOk: boolean;
}) {
  const btn = "flex size-12 shrink-0 items-center justify-center text-xl text-neutral-700 active:bg-neutral-100 disabled:text-neutral-300";
  return (
    <div className="flex items-center">
      <span className="w-12 shrink-0 pl-3 text-sm text-neutral-500">{label}</span>
      <button type="button" aria-label={`${label}を15分早く`} disabled={!minusOk} onClick={onMinus} className={`${btn} border-x border-neutral-200`}>−</button>
      <div className="relative h-12 min-w-0 flex-1">
        <select aria-label={`${label}時刻`} value={value} onChange={(e) => onSelect(Number(e.target.value))}
          className="h-full w-full cursor-pointer appearance-none bg-transparent text-center text-2xl font-semibold tabular-nums outline-none focus:bg-accent-soft [text-align-last:center]">
          {options.map((o) => (
            <option key={o.m} value={o.m} disabled={!o.ok} className={o.ok ? "text-neutral-900" : "text-neutral-300"}>
              {fmtMin(o.m)}{o.ok ? "" : "（×）"}
            </option>
          ))}
        </select>
        <svg className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-neutral-400" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M3 4.5 6 7.5l3-3" />
        </svg>
      </div>
      <button type="button" aria-label={`${label}を15分遅く`} disabled={!plusOk} onClick={onPlus} className={`${btn} border-l border-neutral-200`}>＋</button>
    </div>
  );
}

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex py-3">
      <dt className="w-16 shrink-0 text-sm text-neutral-500">{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  );
}
