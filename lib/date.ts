// 日付はすべて "YYYY-MM-DD"（日本時間）の文字列で扱う
const TZ = "Asia/Tokyo";
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 日本時間の今日の日付と、現在時刻（14:30 → 14.5） */
export function nowJST(): { date: string; hour: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) + Number(p.minute) / 60 };
}

const toUTC = (s: string) => new Date(s + "T00:00:00Z");
const fromUTC = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(s: string, n: number): string {
  const d = toUTC(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
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
export const fmtHour = (h: number) => `${h}:00`;

/** 枠が過ぎているか（開始時刻を過ぎた枠は予約不可） */
export const isPast = (date: string, hour: number, now: { date: string; hour: number }) =>
  date < now.date || (date === now.date && hour <= now.hour);
