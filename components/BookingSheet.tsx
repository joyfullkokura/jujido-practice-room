"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate, fmtHour } from "@/lib/date";
import { tint, type Room, type Selection } from "@/lib/types";

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

export default function BookingSheet({ selection, endOptions, room, roomOptions, source, onChangeEnd, onChangeRoom, onClose, onBooked }: Props) {
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ sel: Selection; room: Room } | null>(null);

  // シートが開いている間は背景をスクロールさせない
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

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
    if (error.code === "23505") setError("選んだ時間に、ちょうど別の予約が入りました。別の時間を選んでください。");
    else if (error.code === "23514") setError("名前と学校名は50文字以内で入力してください。");
    else if (error.code === "P0001") setError(error.message);
    else setError("予約できませんでした。通信状況を確認して、もう一度お試しください。");
  }

  const timeLabel = (s: Selection) => `${fmtDate(s.date)} ${fmtHour(s.start)}〜${fmtHour(s.end)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button aria-label="閉じる" className="animate-fade-in absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="animate-sheet-up relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_30px_rgba(0,0,0,0.12)]">
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-neutral-200" />

        {done ? (
          <div className="py-4 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-accent-soft text-3xl text-accent">✓</div>
            <h2 className="text-xl font-bold">予約が完了しました</h2>
            <p className="mt-3 text-lg">{timeLabel(done.sel)}</p>
            <p className="mt-1 text-neutral-500">{done.room.name}</p>
            <button onClick={onClose} className="mt-8 h-14 w-full rounded-2xl bg-accent text-lg font-bold text-white">閉じる</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2 className="text-xl font-bold">{fmtDate(selection.date)}</h2>

            {roomOptions.length > 1 ? (
              <fieldset className="mt-5">
                <legend className="mb-2 text-sm font-medium text-neutral-600">部屋</legend>
                <div className="flex flex-wrap gap-2">
                  {roomOptions.map((r) => {
                    const active = r.id === room.id;
                    return (
                      <button key={r.id} type="button" onClick={() => onChangeRoom(r.id)}
                        className={`flex h-12 items-center gap-2 rounded-full border px-4 font-medium transition ${
                          active ? "border-accent bg-accent text-white shadow-md shadow-accent/25" : "border-neutral-200 text-neutral-800"}`}>
                        <i className="size-3 rounded-full ring-2 ring-white/70" style={{ background: r.color }} />
                        {r.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : (
              <p className="mt-2 flex items-center gap-2 text-neutral-600">
                <i className="size-3 rounded-full" style={{ background: room.color }} />{room.name}
              </p>
            )}
            {(room.description || room.capacity) && (
              <p className="mt-3 rounded-2xl px-4 py-3 text-sm text-neutral-700" style={{ background: tint(room.color, "14") }}>
                {room.capacity ? <span className="font-medium">定員 {room.capacity}人</span> : null}
                {room.capacity && room.description ? "・" : null}
                {room.description}
              </p>
            )}

            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-medium text-neutral-600">
                時間（{fmtHour(selection.start)} から）
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {endOptions.map((end) => {
                  const active = end === selection.end;
                  return (
                    <button key={end} type="button" onClick={() => onChangeEnd(end)}
                      className={`rounded-2xl border px-2 py-3 text-center transition ${
                        active ? "border-accent bg-accent text-white shadow-md shadow-accent/25" : "border-neutral-200 bg-white text-neutral-800"}`}>
                      <span className="block text-lg font-bold">{end - selection.start}時間</span>
                      <span className={`block text-xs tabular-nums ${active ? "opacity-90" : "text-neutral-500"}`}>〜{fmtHour(end)}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="mt-6 block">
              <span className="mb-2 block text-sm font-medium text-neutral-600">名前 <span className="text-red-500">*</span></span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoComplete="name"
                className="h-14 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-lg outline-none focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/15"
                placeholder="十字 太郎" />
            </label>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-medium text-neutral-600">学校名</span>
              <input value={school} onChange={(e) => setSchool(e.target.value)} maxLength={50}
                className="h-14 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-4 text-lg outline-none focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/15"
                placeholder="○○中学校" />
            </label>

            {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-red-700" role="alert">{error}</p>}

            <button type="submit" disabled={sending}
              className="mt-6 h-14 w-full rounded-2xl bg-accent text-lg font-bold text-white shadow-lg shadow-accent/25 transition active:scale-[0.99] disabled:opacity-60">
              {sending ? "予約しています…" : `${fmtHour(selection.start)}〜${fmtHour(selection.end)} を予約する`}
            </button>
            <button type="button" onClick={onClose} className="mt-2 h-12 w-full rounded-2xl text-neutral-500">キャンセル</button>
          </form>
        )}
      </div>
    </div>
  );
}
