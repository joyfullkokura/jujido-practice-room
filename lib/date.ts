// 日付はすべて "YYYY-MM-DD"（日本時間）の文字列で扱う。日本は夏時間がないので +9時間で計算できる
const JST_MS = 9 * 60 * 60 * 1000;
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 日本時間の今日の日付と、0時からの分 */
export function nowJST(): { date: string; min: number } {
  const d = new Date(Date.now() + JST_MS);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** DB の timestamptz（ISO文字列）→ 日本時間の日付と分 */
export function fromISO(iso: string): { date: string; min: number } {
  const d = new Date(Date.parse(iso) + JST_MS);
  return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** 日本時間の日付と分 → DB に渡す ISO 文字列（例 2026-11-28T15:15:00+09:00） */
export function toISO(date: string, min: number): string {
  const hh = String(Math.floor(min / 60)).padStart(2, "0"), mm = String(min % 60).padStart(2, "0");
  return `${date}T${hh}:${mm}:00+09:00`;
}

const toUTC = (s: string) => new Date(s + "T00:00:00Z");
export function addDays(s: string, n: number): string {
  const d = toUTC(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekday = (s: string) => toUTC(s).getUTCDay();
/** その日を含む週（日曜はじまり）の7日分 */
export function weekOf(s: string): string[] {
  const start = addDays(s, -weekday(s));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
export const dayNum = (s: string) => Number(s.slice(8, 10));
export const monthNum = (s: string) => Number(s.slice(5, 7));
export const yearNum = (s: string) => Number(s.slice(0, 4));
export const fmtDate = (s: string) => `${monthNum(s)}月${dayNum(s)}日(${WEEKDAYS[weekday(s)]})`;

/** その日で、今から予約できる最初の時刻（分）。過去の日は 24時、未来の日は 0 */
export function earliestBookable(date: string, now: { date: string; min: number }) {
  if (date < now.date) return 24 * 60;
  if (date > now.date) return 0;
  return Math.floor(now.min / 15) * 15 + 15; // 15:20 → 15:30 から
}
