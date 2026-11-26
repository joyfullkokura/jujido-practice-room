// 時刻はすべて「日本時間の0時からの分」で扱う（15:15 → 915）
export const OPEN = 10 * 60;   // 10:00
export const CLOSE = 21 * 60;  // 21:00
export const STEP = 15;        // 15分単位
export const MIN_LEN = 30;     // 最短30分
export const MAX_LEN = 180;    // 最長3時間（DB の create_reservation と同じ）
export const HOURS = Array.from({ length: (CLOSE - OPEN) / 60 }, (_, i) => OPEN / 60 + i);

/** 部屋（一般向けには公開中の部屋だけが返る） */
export type Room = {
  id: number; name: string; color: string;
  capacity: number | null; description: string | null; sort_order: number;
};

/** 予約済みの時間帯（booked_slots から。個人情報なし） */
export type Booking = { room_id: number; date: string; start: number; end: number };

/** 選択中の予約内容 */
export type Selection = { roomId: number; date: string; start: number; end: number };

/** グリッドの1列（日表示＝部屋ごと、週表示＝日ごと） */
export type Column = { key: string; roomId: number; date: string };

/** 部屋の色を白に混ぜた「不透明な」薄い色（罫線が透けないように） */
export function tint(hex: string, ratio = 0.14) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * ratio);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

/** 15:15 のような表示 */
export const fmtMin = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
/** 1時間30分 のような表示 */
export const fmtLen = (m: number) =>
  m < 60 ? `${m}分` : m % 60 === 0 ? `${m / 60}時間` : `${Math.floor(m / 60)}時間${m % 60}分`;

/**
 * その位置を含む「空いている時間帯」を返す（予約済み・過去・営業時間外を除く）。
 * 予約できる長さ（30分）がなければ null
 */
export function freeWindow(bookings: Booking[], roomId: number, date: string, at: number, earliest: number) {
  let lo = Math.max(OPEN, earliest), hi = CLOSE;
  for (const b of bookings) {
    if (b.room_id !== roomId || b.date !== date) continue;
    if (at >= b.start && at < b.end) return null;
    if (b.end <= at) lo = Math.max(lo, b.end);
    if (b.start > at) hi = Math.min(hi, b.start);
  }
  if (at < lo || hi - Math.max(lo, at) < MIN_LEN) return null;
  return { lo, hi };
}
