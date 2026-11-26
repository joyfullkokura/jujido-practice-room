"use client";
import { useEffect, useRef, useState } from "react";
import { fmtMin, tint, type Column, type Room, type Selection } from "@/lib/types";
import { STEP, canTouch, dragRange, settleRange, tapRange, type Busy } from "@/lib/slots";

type Range = { open: number; close: number };
type Props = {
  columns: Column[];
  /** 列の見出し */
  header: (col: Column) => React.ReactNode;
  rooms: Room[];
  /** その列の「予約できない時間帯」 */
  busyOf: (col: Column) => Busy[];
  /** グリッドの縦の範囲（営業時間の最も早い開店〜最も遅い閉店） */
  range: Range;
  selection: Selection | null;
  now: { date: string; min: number };
  /** タップ・ドラッグで範囲が決まったとき */
  onSelect: (col: Column, r: { start: number; end: number }) => void;
  /** 列の最小幅。超えると横スクロール（時刻の列は左に固定） */
  minColWidth: string;
};

type Drag = { col: Column; anchor: number; cur: number; moved: boolean };

/** 1時間の高さ。スマホは指で押しやすいように高め */
const HOUR = "[--hour:4.5rem] md:[--hour:3.75rem]";
const TIME_COL = "3.5rem";
const LONG_PRESS_MS = 400;

export default function TimeGrid({ columns, header, rooms, busyOf, range, selection, now, onSelect, minColWidth }: Props) {
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  /** ドラッグを終えた直後の click を無視するため（イベントの timeStamp で比較） */
  const lastGestureEnd = useRef(-Infinity);
  const y = (m: number) => `calc(var(--hour) * ${(m - range.open) / 60})`;
  const h = (len: number) => `calc(var(--hour) * ${len / 60})`;
  const hours = Array.from({ length: Math.ceil((range.close - range.open) / 60) }, (_, i) => range.open + i * 60);
  const template = { gridTemplateColumns: `${TIME_COL} repeat(${columns.length}, minmax(${minColWidth}, 1fr))` };
  const nowVisible = now.min >= range.open && now.min <= range.close && columns.some((c) => c.date === now.date);

  // 最新の値を、ネイティブのイベントリスナーから参照するため
  const latest = useRef({ columns, busyOf, range, onSelect });
  latest.current = { columns, busyOf, range, onSelect };

  const setDragBoth = (d: Drag | null) => { dragRef.current = d; setDrag(d); };

  /** 画面の y 座標 → その列の15分枠 */
  const minuteAt = (colKey: string, clientY: number) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-colkey="${colKey}"]`);
    if (!el) return null;
    const { open, close } = latest.current.range;
    const rect = el.getBoundingClientRect();
    const raw = open + ((clientY - rect.top) / rect.height) * (close - open);
    return Math.min(Math.max(Math.floor(raw / STEP) * STEP, open), close - STEP);
  };

  const finishDrag = (ts: number) => {
    const d = dragRef.current;
    setDragBoth(null);
    if (!d) return;
    lastGestureEnd.current = ts;
    const busy = latest.current.busyOf(d.col);
    // 動かさずに離した＝タップと同じ（その時刻から1時間）
    if (!d.moved) { const t = tapRange(busy, d.anchor); if (t) latest.current.onSelect(d.col, t); return; }
    const r = dragRange(busy, d.anchor, d.cur);
    const settled = r && settleRange(busy, r.start, r.end);
    if (settled) latest.current.onSelect(d.col, settled);
  };

  // マウス：押したまま下になぞると範囲選択
  const onPointerDown = (e: React.PointerEvent, col: Column, m: number) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if (!canTouch(busyOf(col), m)) return;
    e.preventDefault();
    setDragBoth({ col, anchor: m, cur: m, moved: false });
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerType !== "mouse") return;
      const m = minuteAt(d.col.key, e.clientY);
      if (m != null && m !== d.cur) setDragBoth({ ...d, cur: m, moved: true });
    };
    const up = (e: PointerEvent) => { if (e.pointerType === "mouse") finishDrag(e.timeStamp); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  // スマホ：長押ししてからドラッグ（長押し前に指が動いたら普通のスクロール）
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let start: { x: number; y: number } | null = null;

    const cancel = () => { if (timer) clearTimeout(timer); timer = null; start = null; };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return cancel();
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-m]");
      if (!btn) return;
      const col = latest.current.columns.find((c) => c.key === btn.dataset.col);
      const m = Number(btn.dataset.m);
      if (!col || !canTouch(latest.current.busyOf(col), m)) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      timer = setTimeout(() => {
        timer = null;
        navigator.vibrate?.(10);
        setDragBoth({ col, anchor: m, cur: m, moved: false });
      }, LONG_PRESS_MS);
    };
    const onMove = (e: TouchEvent) => {
      const d = dragRef.current;
      if (d) {
        e.preventDefault(); // ドラッグ中はスクロールさせない
        const m = minuteAt(d.col.key, e.touches[0].clientY);
        if (m != null && m !== d.cur) setDragBoth({ ...d, cur: m, moved: true });
        return;
      }
      if (start && Math.hypot(e.touches[0].clientX - start.x, e.touches[0].clientY - start.y) > 8) cancel();
    };
    const onEnd = (e: TouchEvent) => { cancel(); if (dragRef.current) finishDrag(e.timeStamp); };
    body.addEventListener("touchstart", onStart, { passive: true });
    body.addEventListener("touchmove", onMove, { passive: false });
    body.addEventListener("touchend", onEnd);
    body.addEventListener("touchcancel", onEnd);
    return () => {
      cancel();
      body.removeEventListener("touchstart", onStart);
      body.removeEventListener("touchmove", onMove);
      body.removeEventListener("touchend", onEnd);
      body.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // タップ（タッチの短押し・キーボード）は、その時刻から1時間
  const onTap = (e: React.MouseEvent, col: Column, m: number) => {
    if (e.timeStamp - lastGestureEnd.current < 600) return;
    const r = tapRange(busyOf(col), m);
    if (r) onSelect(col, r);
  };

  return (
    <div className={`${HOUR} select-none [-webkit-touch-callout:none]`}>
      {/* 列の見出し（ページの上部に固定。横スクロールは本体と同期） */}
      <div ref={headRef} className="sticky top-[var(--header-h)] z-20 overflow-hidden border-y border-neutral-200 bg-white">
        <div className="grid" style={template}>
          <div className="sticky left-0 z-10 bg-white" />
          {columns.map((c) => (
            <div key={c.key} className="min-w-0 border-l border-neutral-200 px-2 py-2">{header(c)}</div>
          ))}
        </div>
      </div>

      <div ref={bodyRef} data-grid-scroll className="overflow-x-auto overscroll-x-contain"
        onContextMenu={(e) => e.preventDefault()}
        onScroll={(e) => { if (headRef.current) headRef.current.scrollLeft = e.currentTarget.scrollLeft; }}>
        <div className="grid" style={template}>
          {/* 時刻（左に固定） */}
          <div className="sticky left-0 z-10 bg-white" style={{ height: h(range.close - range.open) }}>
            {hours.filter((m) => !nowVisible || now.min < m - 6 || now.min > m + 27).map((m) => (
              <span key={m} className="absolute right-2 text-xs text-neutral-500 tabular-nums" style={{ top: `calc(${y(m)} + 3px)` }}>
                {fmtMin(m)}
              </span>
            ))}
            {nowVisible && (
              <span className="absolute right-1 z-10 -translate-y-1/2 bg-white px-1 text-[11px] font-semibold text-red-600 tabular-nums"
                style={{ top: y(now.min) }}>
                {fmtMin(now.min)}
              </span>
            )}
          </div>

          {columns.map((c) => {
            const busy = busyOf(c);
            const room = rooms.find((r) => r.id === c.roomId);
            const color = room?.color ?? "#868e96";
            const live = drag && drag.col.key === c.key ? dragRange(busy, drag.anchor, drag.cur) : null;
            const sel = live ?? (selection && selection.roomId === c.roomId && selection.date === c.date ? selection : null);
            const clip = (b: Busy) => ({ start: Math.max(b.start, range.open), end: Math.min(b.end, range.close) });
            const gray = busy.filter((b) => b.kind === "hours" || b.kind === "past").map(clip).filter((b) => b.end > b.start);
            const showNow = c.date === now.date && now.min >= range.open && now.min <= range.close;
            const quarters = Array.from({ length: (range.close - range.open) / STEP }, (_, i) => range.open + i * STEP);

            return (
              <div key={c.key} data-colkey={c.key} className="relative border-l border-neutral-200" style={{ height: h(range.close - range.open) }}>
                {/* 罫線：1時間ごとは実線、30分は薄い点線、15分は引かない */}
                {hours.map((m) => (
                  <div key={m} className="pointer-events-none absolute inset-x-0" style={{ top: y(m), height: h(60) }}>
                    <div className="absolute inset-x-0 top-1/2 border-t border-dotted border-neutral-200" />
                    <div className="absolute inset-x-0 bottom-0 border-b border-neutral-200" />
                  </div>
                ))}

                {/* 過ぎた時間・営業時間外はグレー */}
                {gray.map((b, i) => (
                  <div key={i} className="pointer-events-none absolute inset-x-0 bg-neutral-100" style={{ top: y(b.start), height: h(b.end - b.start) }} />
                ))}

                {/* 15分ごとのタップ領域 */}
                {quarters.map((m) => {
                  const ok = canTouch(busy, m);
                  const hit = busy.find((b) => m >= b.start && m < b.end);
                  const state = !hit ? (ok ? "空き" : "予約不可") : hit.kind === "booked" ? "予約済" : hit.kind === "past" ? "受付終了" : "予約不可";
                  return (
                    <button key={m} type="button" disabled={!ok} data-col={c.key} data-m={m}
                      onPointerDown={(e) => onPointerDown(e, c, m)} onClick={(e) => onTap(e, c, m)}
                      aria-label={`${room?.name ?? ""} ${c.date} ${fmtMin(m)} ${state}`}
                      className={`absolute inset-x-0 ${ok ? "hover:bg-accent-soft" : "cursor-default"}`}
                      style={{ top: y(m), height: h(STEP) }} />
                  );
                })}

                {/* 予約不可枠（定休日・店の都合など） */}
                {busy.filter((b) => b.kind === "closed").map((b) => ({ ...b, ...clip(b) })).filter((b) => b.end > b.start).map((b, i) => (
                  <div key={`c${i}`} className="pointer-events-none absolute inset-x-0 overflow-hidden bg-neutral-100 px-1.5 py-0.5"
                    style={{ top: y(b.start), height: h(b.end - b.start),
                      backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, rgba(0,0,0,0.04) 6px 7px)" }}>
                    <p className="truncate text-xs font-semibold text-neutral-500">予約不可</p>
                    {b.label && <p className="truncate text-[11px] text-neutral-500">{b.label}</p>}
                  </div>
                ))}

                {/* 予約済み（実際の時刻どおりの高さ） */}
                {busy.filter((b) => b.kind === "booked").map((b) => (
                  <div key={`b${b.start}`}
                    className="pointer-events-none absolute inset-x-0.5 overflow-hidden rounded-xs border-l-2 px-1.5 py-0.5"
                    style={{ top: `calc(${y(b.start)} + 1px)`, height: `calc(${h(b.end - b.start)} - 2px)`, background: tint(color), borderLeftColor: color }}>
                    <p className="truncate text-xs font-semibold leading-tight text-neutral-800">予約済</p>
                    {b.end - b.start >= 45 && (
                      <p className="truncate text-[11px] leading-tight text-neutral-600 tabular-nums">{fmtMin(b.start)}–{fmtMin(b.end)}</p>
                    )}
                  </div>
                ))}

                {/* 選択中（ドラッグ中はリアルタイム） */}
                {sel && (
                  <div data-testid={live ? "drag-preview" : "selection"}
                    className={`pointer-events-none absolute inset-x-0.5 z-10 overflow-hidden rounded-xs px-1.5 py-0.5 text-white ${live ? "bg-accent/85" : "bg-accent"}`}
                    style={{ top: `calc(${y(sel.start)} + 1px)`, height: `calc(${h(sel.end - sel.start)} - 2px)` }}>
                    <p className="truncate text-xs font-semibold leading-tight">{live ? "ドラッグで選択中" : "選択中"}</p>
                    <p className="truncate text-[11px] leading-tight tabular-nums opacity-90">{fmtMin(sel.start)}–{fmtMin(sel.end)}</p>
                  </div>
                )}

                {/* 現在時刻 */}
                {showNow && <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 -translate-y-1/2 bg-red-600" style={{ top: y(now.min) }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
