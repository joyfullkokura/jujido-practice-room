export const OPEN_HOUR = 10;  // グリッドの開始
export const CLOSE_HOUR = 21; // グリッドの終了（最後の枠は 20:00〜21:00）
export const MAX_HOURS = 3;   // 1回の予約の上限（DB の create_reservation と同じ）
export const HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);

/** booked_slots ビューの1行（個人情報なし） */
export type Slot = { room_id: number; date: string; start_hour: number; group_id: string };

/** グリッドに描く1ブロック（連続した枠をまとめたもの） */
export type Block = { room_id: number; date: string; start: number; end: number };

export type Selection = { date: string; start: number; end: number };

/** 同じ group_id で連続している枠を1ブロックにまとめる */
export function toBlocks(slots: Slot[]): Block[] {
  const sorted = [...slots].sort((a, b) =>
    a.date.localeCompare(b.date) || a.room_id - b.room_id || a.start_hour - b.start_hour);
  const out: (Block & { g: string })[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.g === s.group_id && last.date === s.date && last.room_id === s.room_id && last.end === s.start_hour) {
      last.end++;
    } else {
      out.push({ room_id: s.room_id, date: s.date, start: s.start_hour, end: s.start_hour + 1, g: s.group_id });
    }
  }
  return out.map(({ g: _g, ...b }) => b);
}
