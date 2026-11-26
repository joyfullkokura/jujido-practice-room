"use client";
import { HOURS, OPEN_HOUR, CLOSE_HOUR, type Block, type Selection } from "@/lib/types";
import { WEEKDAYS, dayNum, weekday, isPast, fmtHour } from "@/lib/date";

type Props = {
  days: string[];
  blocks: Block[];
  selection: Selection | null;
  now: { date: string; hour: number };
  onPick: (date: string, hour: number) => void;
};

/** 1枠の高さ。スマホは指で押しやすいように高め */
const ROW = "[--row:4rem] md:[--row:3.5rem]";
const at = (h: number) => `calc(var(--row) * ${h - OPEN_HOUR})`;
const span = (n: number) => `calc(var(--row) * ${n})`;

export default function CalendarGrid({ days, blocks, selection, now, onPick }: Props) {
  const multi = days.length > 1;
  const cols = { gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className={ROW}>
      {/* 曜日の見出し（週表示のみ） */}
      {multi && (
        <div className="sticky top-[var(--header-h)] z-20 grid border-b border-neutral-200 bg-white/95 backdrop-blur" style={cols}>
          <div />
          {days.map((d) => {
            const today = d === now.date;
            const wd = weekday(d);
            return (
              <div key={d} className="flex flex-col items-center gap-1 py-3">
                <span className={`text-xs font-medium ${wd === 0 ? "text-red-500" : wd === 6 ? "text-accent" : "text-neutral-500"}`}>
                  {WEEKDAYS[wd]}
                </span>
                <span className={`flex size-9 items-center justify-center rounded-full text-lg font-medium ${
                  today ? "bg-accent text-white" : "text-neutral-800"}`}>
                  {dayNum(d)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid pt-3" style={cols}>
        {/* 時刻ラベル */}
        <div className="relative" style={{ height: span(CLOSE_HOUR - OPEN_HOUR) }}>
          {[...HOURS, CLOSE_HOUR].map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-xs text-neutral-400 tabular-nums" style={{ top: at(h) }}>
              {fmtHour(h)}
            </span>
          ))}
        </div>

        {days.map((d) => (
          <DayColumn key={d} date={d} multi={multi} now={now} onPick={onPick}
            blocks={blocks.filter((b) => b.date === d)}
            selection={selection?.date === d ? selection : null} />
        ))}
      </div>
    </div>
  );
}

function DayColumn({ date, multi, blocks, selection, now, onPick }: {
  date: string; multi: boolean; blocks: Block[]; selection: Selection | null;
  now: { date: string; hour: number }; onPick: (date: string, hour: number) => void;
}) {
  const booked = (h: number) => blocks.some((b) => h >= b.start && h < b.end);
  const showNow = date === now.date && now.hour >= OPEN_HOUR && now.hour <= CLOSE_HOUR;

  return (
    <div className={`relative ${multi ? "border-l border-neutral-100" : ""}`} style={{ height: span(CLOSE_HOUR - OPEN_HOUR) }}>
      {/* 1時間ごとの枠（押せる場所） */}
      {HOURS.map((h) => {
        const past = isPast(date, h, now);
        const taken = booked(h);
        return (
          <button
            key={h}
            type="button"
            disabled={past || taken}
            onClick={() => onPick(date, h)}
            aria-label={`${date} ${fmtHour(h)} ${past ? "受付終了" : taken ? "予約済" : "空き"}`}
            className={`absolute inset-x-0 border-t border-neutral-100 transition-colors ${
              past ? "cursor-not-allowed bg-neutral-100/80" : "hover:bg-accent-soft active:bg-accent-soft"}`}
            style={{ top: at(h), height: span(1) }}
          />
        );
      })}
      <div className="pointer-events-none absolute inset-x-0 border-t border-neutral-100" style={{ top: at(CLOSE_HOUR) }} />

      {/* 予約済みブロック */}
      {blocks.map((b) => (
        <div key={`${b.room_id}-${b.start}`}
          className="pointer-events-none absolute inset-x-1 overflow-hidden rounded-xl border-l-4 border-accent bg-accent-soft px-2 py-1.5 shadow-sm"
          style={{ top: `calc(${at(b.start)} + 2px)`, height: `calc(${span(b.end - b.start)} - 4px)` }}>
          <p className="truncate text-sm font-bold text-accent">予約済</p>
          <p className="truncate text-xs text-accent/80 tabular-nums">{fmtHour(b.start)}–{fmtHour(b.end)}</p>
        </div>
      ))}

      {/* 選択中の枠 */}
      {selection && (
        <div className="pointer-events-none absolute inset-x-1 z-10 rounded-xl bg-accent px-2 py-1.5 text-white shadow-lg shadow-accent/30"
          style={{ top: `calc(${at(selection.start)} + 2px)`, height: `calc(${span(selection.end - selection.start)} - 4px)` }}>
          <p className="truncate text-sm font-bold">選択中</p>
          <p className="truncate text-xs tabular-nums opacity-90">{fmtHour(selection.start)}–{fmtHour(selection.end)}</p>
        </div>
      )}

      {/* 現在時刻の赤い線 */}
      {showNow && (
        <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: at(now.hour) }}>
          <div className="relative h-0.5 bg-red-500">
            <span className="absolute -left-1.5 -top-[5px] size-3 rounded-full bg-red-500" />
          </div>
        </div>
      )}
    </div>
  );
}
