// 予約できる時間の計算（画面に依存しない純粋な関数だけ。テストからも使う）
// 時刻はすべて「日本時間の0時からの分」。15分単位。
export const STEP = 15;
export const MIN_LEN = 30;
export const MAX_LEN = 180;

/** 予約できない時間帯 */
export type Busy = {
  start: number; end: number;
  /** booked=予約済 closed=予約不可枠 hours=営業時間外 past=過ぎた時間 */
  kind: "booked" | "closed" | "hours" | "past";
  label?: string;
  /** 管理画面用：予約ID・表示する名前など */
  id?: number;
  title?: string;
  sub?: string;
};

/** 1つの列（部屋×日）の「予約できない時間帯」をまとめる */
export function busyList(opts: {
  booked: { start: number; end: number; id?: number; title?: string; sub?: string }[];
  closed?: { start: number; end: number; label?: string }[];
  /** その日の営業時間。null は休業日 */
  hours: { open: number; close: number } | null;
  /** これより前は予約できない（過ぎた時間） */
  earliest: number;
}): Busy[] {
  const out: Busy[] = [
    ...opts.booked.map((b) => ({ ...b, kind: "booked" as const })),
    ...(opts.closed ?? []).map((c) => ({ ...c, kind: "closed" as const })),
  ];
  if (!opts.hours) out.push({ start: 0, end: 24 * 60, kind: "hours" });
  else {
    if (opts.hours.open > 0) out.push({ start: 0, end: opts.hours.open, kind: "hours" });
    if (opts.hours.close < 24 * 60) out.push({ start: opts.hours.close, end: 24 * 60, kind: "hours" });
  }
  if (opts.earliest > 0) out.push({ start: 0, end: Math.min(opts.earliest, 24 * 60), kind: "past" });
  return out;
}

const overlaps = (b: { start: number; end: number }, s: number, e: number) => b.start < e && s < b.end;

/** その15分枠を含む「空いている時間帯」[lo, hi)。枠が埋まっていれば null */
export function windowAt(busy: Busy[], at: number): { lo: number; hi: number } | null {
  if (busy.some((b) => overlaps(b, at, at + STEP))) return null;
  let lo = 0, hi = 24 * 60;
  for (const b of busy) {
    if (b.end <= at) lo = Math.max(lo, b.end);
    if (b.start >= at + STEP) hi = Math.min(hi, b.start);
  }
  return { lo, hi };
}

/** その15分枠から予約を始められるか（グリッドで押せるか）＝30分以上の空きの中にあるか */
export const canTouch = (busy: Busy[], at: number) => {
  const w = windowAt(busy, at);
  return !!w && w.hi - w.lo >= MIN_LEN;
};

/** 開始時刻のリスト：その時刻から30分以上空いていれば選べる */
export function startOptions(busy: Busy[], range: { open: number; close: number }) {
  const out: { m: number; ok: boolean }[] = [];
  for (let m = range.open; m <= range.close - MIN_LEN; m += STEP) {
    const w = windowAt(busy, m);
    out.push({ m, ok: !!w && w.hi - m >= MIN_LEN });
  }
  return out;
}

/** 終了時刻のリスト：開始の30分後〜3時間後、かつ次の予約（予約不可・閉店）の直前まで */
export function endOptions(busy: Busy[], start: number, range: { open: number; close: number }) {
  const w = windowAt(busy, start);
  const max = w ? Math.min(w.hi, start + MAX_LEN) : start;
  const out: { m: number; ok: boolean }[] = [];
  for (let m = start + STEP; m <= range.close; m += STEP) out.push({ m, ok: m >= start + MIN_LEN && m <= max });
  return out;
}

/** 終了の上限（開始から3時間 or 次の予約の直前の早いほう） */
export function maxEnd(busy: Busy[], start: number) {
  const w = windowAt(busy, start);
  return w ? Math.min(w.hi, start + MAX_LEN) : start;
}

/**
 * ドラッグ中の範囲：押した枠(anchor)〜今の枠(cur)。
 * ほかの予約・営業時間外にかかる場合は、かからない位置まで縮める。3時間を超えたら3時間に。
 */
export function dragRange(busy: Busy[], anchor: number, cur: number): { start: number; end: number } | null {
  const w = windowAt(busy, anchor);
  if (!w) return null;
  let start = Math.max(Math.min(anchor, cur), w.lo);
  let end = Math.min(Math.max(anchor, cur) + STEP, w.hi);
  if (end - start > MAX_LEN) {
    if (cur >= anchor) end = start + MAX_LEN;
    else start = end - MAX_LEN;
  }
  return { start, end };
}

/** 範囲を最終的な予約時間に整える：30分に満たなければ、空きの範囲内で30分に広げる */
export function settleRange(busy: Busy[], start: number, end: number): { start: number; end: number } | null {
  if (end - start >= MIN_LEN) return { start, end };
  const w = windowAt(busy, start);
  if (!w) return null;
  if (w.hi - start >= MIN_LEN) return { start, end: start + MIN_LEN };
  if (end - w.lo >= MIN_LEN) return { start: end - MIN_LEN, end };
  return null;
}

/** タップしたとき：その時刻から1時間（空きが足りなければ縮める／後ろが詰まっていれば前にずらす） */
export function tapRange(busy: Busy[], at: number) {
  const w = windowAt(busy, at);
  if (!w) return null;
  return settleRange(busy, at, Math.min(at + 60, w.hi, at + MAX_LEN));
}

/** 開始を変えたとき：長さをなるべく保ち、新しい開始で取れる範囲に収める */
export function moveStart(busy: Busy[], start: number, prevLen: number) {
  const max = maxEnd(busy, start);
  if (max - start < MIN_LEN) return null;
  return { start, end: Math.min(Math.max(start + prevLen, start + MIN_LEN), max) };
}
