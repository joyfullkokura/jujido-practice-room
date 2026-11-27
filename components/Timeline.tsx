"use client";
import { useEffect, useRef, useState } from "react";
import { fmtMin, tint } from "@/lib/types";
import { pickRange, snap, tapPick, type Span } from "@/lib/timeline";

/** 1本の予約ブロック */
export type TLItem = Span & { id: number; color: string; tentative: boolean; used: boolean; title: string; sub: string };
export type TLRow = {
  id: number; name: string; note?: string; badge?: string;
  items: TLItem[];
  /** 予約不可枠・メンテナンス（斜線＋理由） */
  closed: (Span & { label?: string })[];
  /** そのほか選べない時間（過ぎた時間など。灰色） */
  unavailable?: Span[];
};

/** 範囲の選び方。管理画面は既定（ほかの予約にかからなければ自由）、一般の画面は 30分〜3時間・営業時間内などのルールを渡す */
export type PickRules = {
  /** ドラッグ中：押した枠 anchor から今の枠 cur まで */
  drag: (row: TLRow, anchor: number, cur: number) => Span | null;
  /** タップ・クリック */
  tap: (row: TLRow, at: number) => Span | null;
  /** ドラッグを離したときに整える（短すぎる範囲を広げるなど） */
  settle?: (row: TLRow, span: Span) => Span | null;
};

const QW = 20;            // 15分あたりの幅(px)
const PX = QW / 15;       // 1分あたり

/**
 * 予約表：横＝時間、縦＝部屋（管理画面と一般の予約画面で共通）。部屋名の列は左に固定。
 * 空いているところをクリック（タップ）で範囲を選ぶ。PC はマウスでドラッグもできる。
 * 予約ブロックは onItem があれば押せる（管理画面は編集、一般の画面は押せない）。
 */
export default function Timeline({ rows, range, hours, now, selection, onPick, onItem, rules, scrollTo }: {
  rows: TLRow[];
  range: { open: number; close: number };
  /** その日の営業時間（外側は灰色。管理者は営業時間外も登録できる）。null は休業日 */
  hours: { open: number; close: number } | null;
  /** 今日なら現在の分 */
  now: number | null;
  selection: (Span & { roomId: number }) | null;
  onPick: (roomId: number, span: Span) => void;
  onItem?: (id: number) => void;
  rules?: PickRules;
  /** key が変わったとき（日付を変えたときなど）、minute の少し手前まで横スクロールする */
  scrollTo?: { key: string; minute: number };
}) {
  const { open, close } = range;
  const width = (close - open) * PX;
  const hoursList: number[] = [];
  for (let m = open; m < close; m += 60) hoursList.push(m);

  const [drag, setDrag] = useState<{ roomId: number; span: Span } | null>(null);
  const g = useRef<{ roomId: number; anchor: number; x: number; y: number; type: string; moved: boolean } | null>(null);
  const tapOk = useRef(false);

  const minuteAt = (el: HTMLElement, clientX: number) =>
    Math.min(close - 15, Math.max(open, snap(open + (clientX - el.getBoundingClientRect().left) / PX)));
  const blocksOf = (row: TLRow): Span[] => [...row.items, ...row.closed, ...(row.unavailable ?? [])];
  const R: PickRules = rules ?? {
    drag: (row, a, c) => pickRange(blocksOf(row), a, c, open, close),
    tap: (row, at) => tapPick(blocksOf(row), at, open, close),
  };

  // 今の時刻付近（または指定の時刻）まで自動で横スクロール
  const boxRef = useRef<HTMLDivElement>(null);
  const scrollKey = scrollTo ? `${scrollTo.key}` : "";
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !scrollTo) return;
    el.scrollLeft = Math.max(0, (scrollTo.minute - open) * PX - 48);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey, open]);

  const down = (row: TLRow) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    const anchor = minuteAt(e.currentTarget, e.clientX);
    g.current = { roomId: row.id, anchor, x: e.clientX, y: e.clientY, type: e.pointerType, moved: false };
    if (e.pointerType === "mouse") {
      const span = R.drag(row, anchor, anchor);
      if (!span) { g.current = null; return; }
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ roomId: row.id, span });
    }
  };
  const move = (row: TLRow) => (e: React.PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s || s.roomId !== row.id) return;
    if (Math.abs(e.clientX - s.x) > 6 || Math.abs(e.clientY - s.y) > 6) s.moved = true;
    if (s.type !== "mouse") return;
    const span = R.drag(row, s.anchor, minuteAt(e.currentTarget, e.clientX));
    if (span) setDrag({ roomId: row.id, span });
  };
  const up = (row: TLRow) => () => {
    const s = g.current;
    g.current = null;
    setDrag(null);
    if (!s || s.roomId !== row.id) return;
    // タッチ・ペンは click で開く（指を離した瞬間に開くと、続く click が開いたシートの背景に当たって閉じてしまう）
    if (s.type !== "mouse") { tapOk.current = !s.moved; return; }
    const span = s.moved && drag ? (R.settle ? R.settle(row, drag.span) : drag.span) : R.tap(row, s.anchor);
    if (span) onPick(row.id, span);
  };
  const click = (row: TLRow) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!tapOk.current || e.target !== e.currentTarget) return;
    tapOk.current = false;
    const span = R.tap(row, minuteAt(e.currentTarget, e.clientX));
    if (span) onPick(row.id, span);
  };
  const cancel = () => { g.current = null; tapOk.current = false; setDrag(null); };

  const shown = drag ?? (selection ? { roomId: selection.roomId, span: selection } : null);
  const off: Span[] = hours
    ? [{ start: open, end: Math.max(open, hours.open) }, { start: Math.min(close, hours.close), end: close }].filter((s) => s.end > s.start)
    : [{ start: open, end: close }];

  return (
    <div ref={boxRef} className="overflow-x-auto border-y border-neutral-200 md:border" data-timeline>
      <div style={{ width: `calc(var(--tl-label) + ${width}px)` }} className="[--tl-label:6.5rem] md:[--tl-label:9rem]">
        {/* 時刻の見出し */}
        <div className="flex h-7 border-b border-neutral-200 bg-white">
          <div className="sticky left-0 z-20 w-[var(--tl-label)] shrink-0 border-r border-neutral-200 bg-white" />
          <div className="relative" style={{ width }}>
            {hoursList.map((m) => (
              <span key={m} className="absolute top-1.5 pl-1 text-[11px] text-neutral-500 tabular-nums" style={{ left: (m - open) * PX }}>{fmtMin(m)}</span>
            ))}
          </div>
        </div>

        {rows.map((row) => (
          <div key={row.id} className="flex h-14 border-b border-neutral-200 last:border-b-0" data-room={row.id}>
            <div className="sticky left-0 z-20 flex w-[var(--tl-label)] shrink-0 flex-col justify-center border-r border-neutral-200 bg-white px-2">
              <p className="flex items-center gap-1 truncate text-sm font-semibold">
                <span className="truncate">{row.name}</span>
                {row.badge && <span className="shrink-0 text-[10px] font-normal text-neutral-500">{row.badge}</span>}
              </p>
              {row.note && <p className="truncate text-[10px] leading-tight text-neutral-500">{row.note}</p>}
            </div>
            <div
              className="relative cursor-pointer select-none"
              data-track={row.id}
              style={{
                width,
                backgroundImage: "linear-gradient(to right, #d4d4d4 1px, transparent 1px), linear-gradient(to right, #f0f0f0 1px, transparent 1px)",
                backgroundSize: `${QW * 4}px 100%, ${QW}px 100%`,
              }}
              onPointerDown={down(row)} onPointerMove={move(row)} onPointerUp={up(row)} onPointerCancel={cancel} onClick={click(row)}
            >
              {off.map((s, i) => (
                <div key={i} className="pointer-events-none absolute inset-y-0 bg-neutral-100/80" style={{ left: (s.start - open) * PX, width: (s.end - s.start) * PX }} />
              ))}
              {(row.unavailable ?? []).map((s, i) => {
                const l = Math.max(s.start, open), r = Math.min(s.end, close);
                return r > l && <div key={`u${i}`} className="pointer-events-none absolute inset-y-0 bg-neutral-100/80" style={{ left: (l - open) * PX, width: (r - l) * PX }} />;
              })}
              {row.closed.map((c, i) => (
                <div key={`c${i}`} className="pointer-events-none absolute inset-y-0 overflow-hidden border-x border-neutral-300 px-1.5 pt-1 text-[11px] text-neutral-500"
                  style={{ left: (Math.max(c.start, open) - open) * PX, width: (Math.min(c.end, close) - Math.max(c.start, open)) * PX,
                    backgroundImage: "repeating-linear-gradient(135deg, #eee 0 6px, #fafafa 6px 12px)" }}>
                  {c.label ?? "予約不可"}
                </div>
              ))}
              {row.items.map((it) => {
                const l = Math.max(it.start, open), r = Math.min(it.end, close);
                if (r <= l) return null;
                const Tag = onItem ? "button" : "div";
                return (
                  <Tag key={it.id} type={onItem ? "button" : undefined} data-item={it.id} onClick={onItem ? () => onItem(it.id) : undefined}
                    title={`${fmtMin(it.start)}〜${fmtMin(it.end)} ${it.title}`}
                    className={`absolute inset-y-1 overflow-clip rounded-xs border-l-[3px] px-1.5 text-left text-[11px] leading-tight ${it.tentative ? "border-dashed" : ""}`}
                    style={{
                      left: (l - open) * PX + 1, width: (r - l) * PX - 2,
                      borderColor: it.color,
                      background: it.tentative ? "#fff" : tint(it.color, 0.2),
                      outline: it.tentative ? `1px dashed ${it.color}` : undefined, outlineOffset: -1,
                      color: it.tentative ? "#525252" : "#171717",
                    }}>
                    {/* 横スクロールでブロックの左端が部屋名の下に隠れても、文字は部屋名のすぐ右に残す */}
                    <span className="sticky inline-block max-w-full align-top" style={{ left: "calc(var(--tl-label) + 6px)" }}>
                      <span className="block truncate pt-1 tabular-nums text-neutral-600">{fmtMin(it.start)}-{fmtMin(it.end)}{it.tentative ? " 仮" : it.used ? " 済" : ""}</span>
                      <span className="block truncate font-semibold">{it.title}</span>
                      {it.sub && <span className="block truncate text-neutral-600">{it.sub}</span>}
                    </span>
                  </Tag>
                );
              })}
              {shown?.roomId === row.id && (
                <div data-testid="tl-preview" className="pointer-events-none absolute inset-y-1 z-10 rounded-xs border-2 border-accent bg-accent-soft/70 px-1 text-[11px] font-semibold text-accent tabular-nums"
                  style={{ left: (shown.span.start - open) * PX, width: (shown.span.end - shown.span.start) * PX }}>
                  {fmtMin(shown.span.start)}-{fmtMin(shown.span.end)}
                </div>
              )}
              {now != null && now >= open && now < close && (
                <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-red-600" style={{ left: (now - open) * PX }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
