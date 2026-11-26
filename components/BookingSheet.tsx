"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate, toISO } from "@/lib/date";
import { MAX_LEN, MIN_LEN, STEP, fmtLen, fmtMin, type Room, type Selection } from "@/lib/types";
import BottomSheet from "@/components/BottomSheet";

type Props = {
  selection: Selection;
  /** 選んだ位置を含む空き時間帯（この範囲で開始・終了を動かせる） */
  window: { lo: number; hi: number };
  room: Room;
  source: string | null;
  onChange: (sel: Selection) => void;
  onClose: () => void;
  onBooked: () => void;
};

const input = "h-12 w-full rounded-sm border border-neutral-300 bg-white px-3 text-[17px] outline-none placeholder:text-neutral-400 focus:border-accent focus:ring-1 focus:ring-accent";
const labelCls = "mb-1.5 block text-sm font-semibold text-neutral-700";
const PRESETS = [30, 60, 90, 120, 180];

export default function BookingSheet({ selection, window: win, room, source, onChange, onClose, onBooked }: Props) {
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ sel: Selection; room: Room } | null>(null);
  const { start, end } = selection;
  const len = end - start;
  const maxEnd = (s: number) => Math.min(win.hi, s + MAX_LEN);

  useEffect(() => setError(""), [selection.date, start, end, selection.roomId]);

  /** 開始を動かす：長さはなるべく保つ */
  const moveStart = (s: number) => onChange({ ...selection, start: s, end: Math.min(Math.max(s + len, s + MIN_LEN), maxEnd(s)) });
  const canStart = (s: number) => s >= win.lo && maxEnd(s) - s >= MIN_LEN;
  const canEnd = (e: number) => e - start >= MIN_LEN && e <= maxEnd(start);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("名前を入力してください");
    setSending(true);
    setError("");
    const { error } = await supabase.rpc("create_reservation", {
      p_room_id: selection.roomId,
      p_start_at: toISO(selection.date, start), p_end_at: toISO(selection.date, end),
      p_name: name, p_school: school, p_source: source,
    });
    setSending(false);
    if (!error) { setDone({ sel: selection, room }); onBooked(); return; }
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
          {room.description && <p className="mt-1 text-sm text-neutral-500">{room.description}</p>}

          {/* 時間：開始・終了を15分ずつ調整 */}
          <div className="mt-5">
            <span className={labelCls}>時間</span>
            <div className="divide-y divide-neutral-200 rounded-sm border border-neutral-300">
              <Stepper label="開始" value={start}
                onMinus={() => moveStart(start - STEP)} minusOk={canStart(start - STEP)}
                onPlus={() => moveStart(start + STEP)} plusOk={canStart(start + STEP)} />
              <Stepper label="終了" value={end}
                onMinus={() => onChange({ ...selection, end: end - STEP })} minusOk={canEnd(end - STEP)}
                onPlus={() => onChange({ ...selection, end: end + STEP })} plusOk={canEnd(end + STEP)} />
            </div>
            <div className="mt-2 grid grid-cols-5 gap-px overflow-hidden rounded-sm border border-neutral-300 bg-neutral-300">
              {PRESETS.map((p) => {
                const ok = canEnd(start + p), active = len === p;
                return (
                  <button key={p} type="button" disabled={!ok} aria-pressed={active}
                    onClick={() => onChange({ ...selection, end: start + p })}
                    className={`h-10 text-sm tabular-nums ${active ? "bg-accent-soft font-semibold text-accent" : ok ? "bg-white text-neutral-700" : "bg-neutral-50 text-neutral-300"}`}>
                    {p < 60 ? `${p}分` : `${p / 60}時間`}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="mt-5 block">
            <span className={labelCls}>名前<span className="ml-1 text-xs font-normal text-red-600">必須</span></span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoComplete="name"
              className={input} placeholder="十字 太郎" />
          </label>
          <label className="mt-4 block">
            <span className={labelCls}>学校名</span>
            <input value={school} onChange={(e) => setSchool(e.target.value)} maxLength={50}
              className={input} placeholder="○○中学校" />
          </label>

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

function Stepper({ label, value, onMinus, onPlus, minusOk, plusOk }: {
  label: string; value: number; onMinus: () => void; onPlus: () => void; minusOk: boolean; plusOk: boolean;
}) {
  const btn = "flex size-12 items-center justify-center text-xl text-neutral-700 active:bg-neutral-100 disabled:text-neutral-300";
  return (
    <div className="flex items-center">
      <span className="w-14 pl-3 text-sm text-neutral-500">{label}</span>
      <button type="button" aria-label={`${label}を15分早く`} disabled={!minusOk} onClick={onMinus} className={`${btn} border-x border-neutral-200`}>−</button>
      <span className="flex-1 text-center text-2xl font-semibold tabular-nums">{fmtMin(value)}</span>
      <button type="button" aria-label={`${label}を15分遅く`} disabled={!plusOk} onClick={onPlus} className={`${btn} border-l border-neutral-200`}>＋</button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex py-3">
      <dt className="w-16 shrink-0 text-sm text-neutral-500">{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  );
}
