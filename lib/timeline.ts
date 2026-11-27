// 管理画面の予約表（横＝時間）で範囲を選ぶ計算。画面に依存しない純粋な関数（テストからも使う）
// 管理者は営業時間外・3時間超も登録できるので、制限は「ほかの予約・予約不可枠と重ならない」ことと表示範囲だけ
export const Q = 15;
export type Span = { start: number; end: number };

const hit = (b: Span, s: number, e: number) => b.start < e && s < b.end;

/** at を含む15分枠の空き範囲 [start, end)。埋まっていれば null */
export function freeWindow(blocks: Span[], at: number, lo: number, hi: number): Span | null {
  if (at < lo || at >= hi || blocks.some((b) => hit(b, at, at + Q))) return null;
  let start = lo, end = hi;
  for (const b of blocks) {
    if (b.end <= at) start = Math.max(start, b.end);
    if (b.start >= at + Q) end = Math.min(end, b.start);
  }
  return { start, end };
}

/** ドラッグ：押した枠 anchor から今の枠 cur まで。ほかの予約にかかる手前で止める */
export function pickRange(blocks: Span[], anchor: number, cur: number, lo: number, hi: number): Span | null {
  const w = freeWindow(blocks, anchor, lo, hi);
  if (!w) return null;
  const a = Math.min(anchor, cur), b = Math.max(anchor, cur) + Q;
  return { start: Math.max(a, w.start), end: Math.min(b, w.end) };
}

/** タップ：その枠から1時間（空きが短ければその分だけ） */
export function tapPick(blocks: Span[], at: number, lo: number, hi: number, len = 60): Span | null {
  const w = freeWindow(blocks, at, lo, hi);
  return w ? { start: at, end: Math.min(at + len, w.end) } : null;
}

/** 画面の分（x 座標から）を15分単位に */
export const snap = (m: number) => Math.floor(m / Q) * Q;
