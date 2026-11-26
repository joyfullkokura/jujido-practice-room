"use client";
import { HOURS, OPEN_HOUR, CLOSE_HOUR, tint, type Block, type Room, type Selection } from "@/lib/types";
import { WEEKDAYS, dayNum, weekday, isPast, fmtHour } from "@/lib/date";

type Props = {
  days: string[];
  blocks: Block[];
  /** 表示中の部屋（「すべて」なら全部屋） */
  rooms: Room[];
  selection: Selection | null;
  now: { date: string; hour: number };
  /** 表示中の部屋がすべて埋まっているか */
  isFull: (date: string, hour: number) => boolean;
  onPick: (date: string, hour: number) => void;
};

/** 1枠の高さ。スマホは指で押しやすいように高め */
const ROW = "[--row:4rem] md:[--row:3.5rem]";
const at = (h: number) => `calc(var(--row) * ${h - OPEN_HOUR})`;
const span = (n: number) => `calc(var(--row) * ${n})`;
const hm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

export default function CalendarGrid({ days, blocks, rooms, selection, now, isFull, onPick }: Props) {
  const multi = days.length > 1;
  const cols = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` };
  const showNow = days.includes(now.date) && now.hour >= OPEN_HOUR && now.hour <= CLOSE_HOUR;

  return (
    <div className={`${ROW} border-t border-neutral-200`}>
      {/* 曜日の見出し（週表示のみ） */}
      {multi && (
        <div className="sticky top-[var(--header-h)] z-20 grid border-b border-neutral-200 bg-white" style={cols}>
          <div />
          {days.map((d) => {
            const today = d === now.date;
            const wd = weekday(d);
            return (
              <div key={d} className="flex items-baseline justify-center gap-1.5 border-l border-neutral-200 py-2.5">
                <span className={`text-xs ${wd === 0 ? "text-red-600" : wd === 6 ? "text-accent" : "text-neutral-500"}`}>
                  {WEEKDAYS[wd]}
                </span>
                <span className={`text-lg tabular-nums ${today ? "font-bold text-accent" : "font-medium text-neutral-800"}`}>
                  {dayNum(d)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid" style={cols}>
        {/* 時刻ラベル */}
        <div className="relative" style={{ height: span(CLOSE_HOUR - OPEN_HOUR) }}>
          {HOURS.filter((h) => !showNow || now.hour < h - 0.1 || now.hour > h + 0.45).map((h) => (
            <span key={h} className="absolute right-2 text-xs text-neutral-500 tabular-nums" style={{ top: `calc(${at(h)} + 4px)` }}>
              {fmtHour(h)}
            </span>
          ))}
          {showNow && (
            <span className="absolute right-1 z-10 -translate-y-1/2 bg-white px-1 text-[11px] font-semibold text-red-600 tabular-nums"
              style={{ top: at(now.hour) }}>
              {hm(now.hour)}
            </span>
          )}
        </div>

        {days.map((d) => (
          <DayColumn key={d} date={d} now={now} rooms={rooms} isFull={isFull} onPick={onPick}
            blocks={blocks.filter((b) => b.date === d)}
            selection={selection?.date === d ? selection : null} />
        ))}
      </div>
    </div>
  );
}

function DayColumn({ date, blocks, rooms, selection, now, isFull, onPick }: {
  date: string; blocks: Block[]; rooms: Room[]; selection: Selection | null;
  now: { date: string; hour: number }; isFull: (date: string, hour: number) => boolean;
  onPick: (date: string, hour: number) => void;
}) {
  const showNow = date === now.date && now.hour >= OPEN_HOUR && now.hour <= CLOSE_HOUR;
  // 複数の部屋を表示するときは、部屋ごとに縦のレーンに分けて並べる
  const lanes = rooms.length;
  const lane = (roomId: number) => {
    if (lanes <= 1) return { left: "2px", width: "calc(100% - 4px)" };
    const i = Math.max(0, rooms.findIndex((r) => r.id === roomId));
    return { left: `calc(${i} * 100% / ${lanes} + 1px)`, width: `calc(100% / ${lanes} - 2px)` };
  };
  const roomOf = (id: number) => rooms.find((r) => r.id === id);

  return (
    <div className="relative border-l border-neutral-200" style={{ height: span(CLOSE_HOUR - OPEN_HOUR) }}>
      {/* 1時間ごとの枠（押せる場所） */}
      {HOURS.map((h) => {
        const past = isPast(date, h, now);
        const full = isFull(date, h);
        return (
          <button
            key={h}
            type="button"
            disabled={past || full}
            onClick={() => onPick(date, h)}
            aria-label={`${date} ${fmtHour(h)} ${past ? "受付終了" : full ? "予約済" : "空き"}`}
            className={`absolute inset-x-0 border-b border-neutral-200 ${
              past ? "cursor-not-allowed bg-neutral-100" : "hover:bg-accent-soft active:bg-accent-soft"}`}
            style={{ top: at(h), height: span(1) }}
          />
        );
      })}

      {/* 予約済みブロック（部屋の色は左端の線と薄い背景だけ） */}
      {blocks.map((b) => {
        const room = roomOf(b.room_id);
        const color = room?.color ?? "#868e96";
        return (
          <div key={`${b.room_id}-${b.start}`}
            className="pointer-events-none absolute overflow-hidden rounded-xs border-l-2 px-1.5 py-1"
            style={{ ...lane(b.room_id), top: `calc(${at(b.start)} + 1px)`, height: `calc(${span(b.end - b.start)} - 2px)`,
              background: tint(color, "1a"), borderLeftColor: color }}>
            <p className="truncate text-xs font-semibold text-neutral-800">
              {lanes > 1 ? room?.name.replace(/^.*練習室/, "") || "予約済" : "予約済"}
            </p>
            <p className="truncate text-[11px] text-neutral-600 tabular-nums">{fmtHour(b.start)}–{fmtHour(b.end)}</p>
          </div>
        );
      })}

      {/* 選択中の枠 */}
      {selection && (
        <div className="pointer-events-none absolute z-10 rounded-xs bg-accent px-1.5 py-1 text-white"
          style={{ ...lane(selection.roomId), top: `calc(${at(selection.start)} + 1px)`, height: `calc(${span(selection.end - selection.start)} - 2px)` }}>
          <p className="truncate text-xs font-semibold">選択中</p>
          <p className="truncate text-[11px] tabular-nums opacity-90">{fmtHour(selection.start)}–{fmtHour(selection.end)}</p>
        </div>
      )}

      {/* 現在時刻の赤い線 */}
      {showNow && (
        <div className="pointer-events-none absolute inset-x-0 z-10 h-px bg-red-600" style={{ top: at(now.hour) }} />
      )}
    </div>
  );
}
