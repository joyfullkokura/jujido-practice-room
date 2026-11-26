"use client";
import { useRef } from "react";
import { HOURS, OPEN, CLOSE, STEP, fmtMin, tint, freeWindow, type Booking, type Column, type Room, type Selection } from "@/lib/types";
import { earliestBookable } from "@/lib/date";

type Props = {
  columns: Column[];
  /** 列の見出し */
  header: (col: Column) => React.ReactNode;
  rooms: Room[];
  bookings: Booking[];
  selection: Selection | null;
  now: { date: string; min: number };
  onPick: (col: Column, min: number) => void;
  /** 列の最小幅。超えると横スクロール（時刻の列は左に固定） */
  minColWidth: string;
};

/** 1時間の高さ。スマホは指で押しやすいように高め */
const HOUR = "[--hour:4.5rem] md:[--hour:3.75rem]";
const y = (m: number) => `calc(var(--hour) * ${(m - OPEN) / 60})`;
const h = (len: number) => `calc(var(--hour) * ${len / 60})`;
const QUARTERS = Array.from({ length: (CLOSE - OPEN) / STEP }, (_, i) => OPEN + i * STEP);
const TIME_COL = "3.5rem";

export default function TimeGrid({ columns, header, rooms, bookings, selection, now, onPick, minColWidth }: Props) {
  const headRef = useRef<HTMLDivElement>(null);
  const template = { gridTemplateColumns: `${TIME_COL} repeat(${columns.length}, minmax(${minColWidth}, 1fr))` };
  const nowVisible = now.min >= OPEN && now.min <= CLOSE && columns.some((c) => c.date === now.date);

  return (
    <div className={HOUR}>
      {/* 列の見出し（ページの上部に固定。横スクロールは本体と同期） */}
      <div ref={headRef} className="sticky top-[var(--header-h)] z-20 overflow-hidden border-y border-neutral-200 bg-white">
        <div className="grid" style={template}>
          <div className="sticky left-0 z-10 bg-white" />
          {columns.map((c) => (
            <div key={c.key} className="min-w-0 border-l border-neutral-200 px-2 py-2">{header(c)}</div>
          ))}
        </div>
      </div>

      <div data-grid-scroll className="overflow-x-auto overscroll-x-contain"
        onScroll={(e) => { if (headRef.current) headRef.current.scrollLeft = e.currentTarget.scrollLeft; }}>
        <div className="grid" style={template}>
          {/* 時刻（左に固定） */}
          <div className="sticky left-0 z-10 bg-white" style={{ height: h(CLOSE - OPEN) }}>
            {HOURS.filter((hr) => !nowVisible || now.min < hr * 60 - 6 || now.min > hr * 60 + 27).map((hr) => (
              <span key={hr} className="absolute right-2 text-xs text-neutral-500 tabular-nums" style={{ top: `calc(${y(hr * 60)} + 3px)` }}>
                {hr}:00
              </span>
            ))}
            {nowVisible && (
              <span className="absolute right-1 z-10 -translate-y-1/2 bg-white px-1 text-[11px] font-semibold text-red-600 tabular-nums"
                style={{ top: y(now.min) }}>
                {fmtMin(now.min)}
              </span>
            )}
          </div>

          {columns.map((c) => (
            <GridColumn key={c.key} col={c} now={now} onPick={onPick}
              room={rooms.find((r) => r.id === c.roomId)}
              bookings={bookings.filter((b) => b.room_id === c.roomId && b.date === c.date)}
              selection={selection && selection.roomId === c.roomId && selection.date === c.date ? selection : null} />
          ))}
        </div>
      </div>
    </div>
  );
}

function GridColumn({ col, room, bookings, selection, now, onPick }: {
  col: Column; room?: Room; bookings: Booking[]; selection: Selection | null;
  now: { date: string; min: number }; onPick: (col: Column, min: number) => void;
}) {
  const earliest = earliestBookable(col.date, now);
  const pastUntil = Math.min(Math.max(earliest, OPEN), CLOSE);
  const color = room?.color ?? "#868e96";
  const showNow = col.date === now.date && now.min >= OPEN && now.min <= CLOSE;

  return (
    <div className="relative border-l border-neutral-200" style={{ height: h(CLOSE - OPEN) }}>
      {/* 罫線：1時間ごとは実線、30分は薄い点線、15分は引かない */}
      {HOURS.map((hr) => (
        <div key={hr} className="pointer-events-none absolute inset-x-0" style={{ top: y(hr * 60), height: h(60) }}>
          <div className="absolute inset-x-0 top-1/2 border-t border-dotted border-neutral-200" />
          <div className="absolute inset-x-0 bottom-0 border-b border-neutral-200" />
        </div>
      ))}

      {/* 過ぎた時間はグレー */}
      {pastUntil > OPEN && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-neutral-100" style={{ height: h(pastUntil - OPEN) }} />
      )}

      {/* 15分ごとのタップ領域 */}
      {QUARTERS.map((m) => {
        const past = m < earliest;
        const ok = !past && freeWindow(bookings, col.roomId, col.date, m, earliest) !== null;
        const taken = bookings.some((b) => m >= b.start && m < b.end);
        return (
          <button key={m} type="button" disabled={!ok} onClick={() => onPick(col, m)}
            aria-label={`${room?.name ?? ""} ${col.date} ${fmtMin(m)} ${past ? "受付終了" : taken ? "予約済" : ok ? "空き" : "予約不可"}`}
            className={`absolute inset-x-0 ${ok ? "hover:bg-accent-soft" : "cursor-default"}`}
            style={{ top: y(m), height: h(STEP) }} />
        );
      })}

      {/* 予約済み（実際の時刻どおりの高さ） */}
      {bookings.map((b) => (
        <div key={b.start}
          className="pointer-events-none absolute inset-x-0.5 overflow-hidden rounded-xs border-l-2 px-1.5 py-0.5"
          style={{ top: `calc(${y(b.start)} + 1px)`, height: `calc(${h(b.end - b.start)} - 2px)`, background: tint(color), borderLeftColor: color }}>
          <p className="truncate text-xs font-semibold leading-tight text-neutral-800">予約済</p>
          {b.end - b.start >= 45 && (
            <p className="truncate text-[11px] leading-tight text-neutral-600 tabular-nums">{fmtMin(b.start)}–{fmtMin(b.end)}</p>
          )}
        </div>
      ))}

      {/* 選択中 */}
      {selection && (
        <div className="pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded-xs bg-accent px-1.5 py-0.5 text-white"
          style={{ top: `calc(${y(selection.start)} + 1px)`, height: `calc(${h(selection.end - selection.start)} - 2px)` }}>
          <p className="truncate text-xs font-semibold leading-tight">選択中</p>
          <p className="truncate text-[11px] leading-tight tabular-nums opacity-90">{fmtMin(selection.start)}–{fmtMin(selection.end)}</p>
        </div>
      )}

      {/* 現在時刻 */}
      {showNow && <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 -translate-y-1/2 bg-red-600" style={{ top: y(now.min) }} />}
    </div>
  );
}
