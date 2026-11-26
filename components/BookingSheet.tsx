"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate, fmtHour } from "@/lib/date";
import type { Room, Selection } from "@/lib/types";
import BottomSheet from "@/components/BottomSheet";

type Props = {
  selection: Selection;
  /** 開始時刻から選べる終了時刻（例：[16, 17, 18]） */
  endOptions: number[];
  room: Room;
  /** この開始時刻で空いている部屋（2つ以上あれば選べる） */
  roomOptions: Room[];
  source: string | null;
  onChangeEnd: (end: number) => void;
  onChangeRoom: (roomId: number) => void;
  onClose: () => void;
  onBooked: () => void;
};

const input = "h-12 w-full rounded-sm border border-neutral-300 bg-white px-3 text-[17px] outline-none placeholder:text-neutral-400 focus:border-accent focus:ring-1 focus:ring-accent";
const labelCls = "mb-1.5 block text-sm font-semibold text-neutral-700";

export default function BookingSheet({ selection, endOptions, room, roomOptions, source, onChangeEnd, onChangeRoom, onClose, onBooked }: Props) {
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ sel: Selection; room: Room } | null>(null);

  useEffect(() => setError(""), [selection.date, selection.start, selection.end, selection.roomId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("名前を入力してください");
    setSending(true);
    setError("");
    const { error } = await supabase.rpc("create_reservation", {
      p_room_id: selection.roomId, p_date: selection.date,
      p_start_hour: selection.start, p_end_hour: selection.end,
      p_name: name, p_school: school, p_source: source,
    });
    setSending(false);
    if (!error) { setDone({ sel: selection, room }); onBooked(); return; }
    if (error.code === "23505" || error.code === "23P01") setError("選んだ時間に、ちょうど別の予約が入りました。別の時間を選んでください。");
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
            <Row k="時間" v={`${fmtHour(done.sel.start)}〜${fmtHour(done.sel.end)}`} />
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

          {roomOptions.length > 1 ? (
            <fieldset className="mt-5">
              <legend className={labelCls}>部屋</legend>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-neutral-300 bg-neutral-300">
                {roomOptions.map((r) => {
                  const active = r.id === room.id;
                  return (
                    <button key={r.id} type="button" onClick={() => onChangeRoom(r.id)} aria-pressed={active}
                      className={`flex h-12 items-center justify-center gap-2 text-[15px] ${
                        active ? "bg-accent-soft font-semibold text-accent" : "bg-white text-neutral-800"}`}>
                      <i className="size-2 rounded-xs" style={{ background: r.color }} />
                      {r.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <p className="mt-1 flex items-center gap-2 text-[15px] text-neutral-700">
              <i className="size-2 rounded-xs" style={{ background: room.color }} />{room.name}
            </p>
          )}
          {(room.description || room.capacity) && (
            <p className="mt-2 text-sm text-neutral-600">
              {room.capacity ? `定員 ${room.capacity}人` : ""}
              {room.capacity && room.description ? "　" : ""}
              {room.description}
            </p>
          )}

          <fieldset className="mt-5">
            <legend className={labelCls}>時間（{fmtHour(selection.start)} から）</legend>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-neutral-300 bg-neutral-300">
              {[1, 2, 3].map((n) => {
                const end = selection.start + n;
                const ok = endOptions.includes(end);
                const active = end === selection.end;
                return (
                  <button key={n} type="button" disabled={!ok} onClick={() => onChangeEnd(end)} aria-pressed={active}
                    className={`py-2.5 text-center ${
                      active ? "bg-accent-soft text-accent" : ok ? "bg-white text-neutral-800" : "bg-neutral-50 text-neutral-300"}`}>
                    <span className={`block text-[17px] ${active ? "font-bold" : "font-medium"}`}>{n}時間</span>
                    <span className="block text-xs tabular-nums">〜{fmtHour(end)}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

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
            className="mt-6 h-12 w-full rounded-sm bg-accent text-base font-semibold text-white active:bg-[#2647a8] disabled:opacity-60">
            {sending ? "予約しています…" : `${fmtHour(selection.start)}〜${fmtHour(selection.end)} で予約する`}
          </button>
        </form>
      )}
    </BottomSheet>
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
