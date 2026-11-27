// 月次の集計（稼働率・区分別・ヒートマップ・売上・流入元）。画面に依存しない純粋な関数（テストからも使う）
// 時刻は日本時間の「0時からの分」。料金は予約に記録済みの値（price_total など）を足すだけなので CSV と必ず一致する
import { addDays, fromISO, weekday } from "./date";
import { DEFAULT_CLOSE, DEFAULT_OPEN } from "./types";

/** 稼働率の分母にする時間帯の既定値（試作どおり 9:00〜21:00。設定 shop_settings で変更できる） */
export const WINDOW = { open: 9 * 60, close: 21 * 60 };
export const heatHoursOf = (w: { open: number; close: number }) => Array.from({ length: Math.max(0, Math.ceil((w.close - w.open) / 60)) }, (_, i) => Math.floor(w.open / 60) + i);

type Row = {
  id: number; room_id: number; start_at: string; end_at: string; status: string; deleted_at?: string | null;
  category: string; payment: string; price_total: number; source: string | null; school: string | null;
};
type HoursRow = { weekday: number; open_time: string; close_time: string; is_closed: boolean };
type ClosureRow = { room_id: number | null; start_at: string; end_at: string };

export type RoomStat = { roomId: number; avail: number; availIn: number; planned: number; plannedIn: number; actual: number; revenue: number };
export type MonthStats = {
  days: string[];
  rooms: RoomStat[];
  total: Omit<RoomStat, "roomId">;
  /** 区分ごとの利用時間（分）。メンテナンスは含まない */
  catMin: Record<string, number>;
  /** heat[曜日][時] = 利用分 。heatDays[曜日] = その曜日の営業日数。heatHours = 列の時（9, 10, …） */
  heat: number[][]; heatDays: number[]; heatHours: number[];
  revenue: { total: number; paid: number; unpaid: number; count: number };
  sources: [string, number][]; schools: [string, number][];
};

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const ov = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));

export function monthDays(month: string): string[] {
  const out: string[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}

/** その日の営業時間（null は休業日） */
export function hoursFor(hours: HoursRow[] | null, date: string) {
  const r = hours?.find((h) => h.weekday === weekday(date));
  if (!r) return { open: DEFAULT_OPEN, close: DEFAULT_CLOSE };
  return r.is_closed ? null : { open: toMin(r.open_time), close: toMin(r.close_time) };
}

/** ISO の範囲を、その日の [開始分, 終了分] に切る（日をまたぐ分は切り捨て） */
function clip(startISO: string, endISO: string, date: string): [number, number] | null {
  const s = fromISO(startISO), e = fromISO(endISO);
  const a = s.date < date ? 0 : s.date === date ? s.min : null;
  const b = e.date > date ? 24 * 60 : e.date === date ? e.min : null;
  if (a == null || b == null || b <= a) return null;
  return [a, b];
}

export const sourceName = (s: string | null) => (s === "admin" ? "電話・店頭（管理者）" : s || "（なし）");

export function monthStats(p: { month: string; rows: Row[]; roomIds: number[]; hours: HoursRow[] | null; closures: ClosureRow[];
  window?: { open: number; close: number } }): MonthStats {
  const W = p.window ?? WINDOW;
  const HEAT_HOURS = heatHoursOf(W);
  const days = monthDays(p.month).filter((d) => hoursFor(p.hours, d));
  const daySet = new Set(days);
  const rs = new Map<number, RoomStat>(p.roomIds.map((id) => [id, { roomId: id, avail: 0, availIn: 0, planned: 0, plannedIn: 0, actual: 0, revenue: 0 }]));
  const heat = Array.from({ length: 7 }, () => HEAT_HOURS.map(() => 0));
  const heatDays = Array(7).fill(0);
  const catMin: Record<string, number> = {};
  const revenue = { total: 0, paid: 0, unpaid: 0, count: 0 };
  const src = new Map<string, number>(), sch = new Map<string, number>();

  // 分母：営業日 × 部屋 × 12時間。予約不可枠の分は引く
  for (const d of days) {
    const h = hoursFor(p.hours, d)!;
    heatDays[weekday(d)]++;
    for (const st of rs.values()) {
      st.avail += W.close - W.open;
      st.availIn += ov(h.open, h.close, W.open, W.close);
      for (const c of p.closures) {
        if (c.room_id != null && c.room_id !== st.roomId) continue;
        const m = clip(c.start_at, c.end_at, d);
        if (!m) continue;
        st.avail -= ov(m[0], m[1], W.open, W.close);
        st.availIn -= ov(m[0], m[1], Math.max(W.open, h.open), Math.min(W.close, h.close));
      }
    }
  }

  for (const r of p.rows) {
    if (r.status === "cancelled" || r.deleted_at) continue;
    const s = fromISO(r.start_at);
    if (!s.date.startsWith(p.month)) continue;
    src.set(sourceName(r.source), (src.get(sourceName(r.source)) ?? 0) + 1);
    if (r.school) sch.set(r.school, (sch.get(r.school) ?? 0) + 1);
    if (r.category === "rental") {
      revenue.total += r.price_total; revenue.count++;
      if (r.payment === "paid") revenue.paid += r.price_total;
      if (r.payment === "unpaid") revenue.unpaid += r.price_total;
      const st = rs.get(r.room_id);
      if (st) st.revenue += r.price_total;
    }
    const st = rs.get(r.room_id);
    const m = clip(r.start_at, r.end_at, s.date);
    if (!st || !m || !daySet.has(s.date)) continue;   // 休業日の予約は稼働率に入れない
    const h = hoursFor(p.hours, s.date)!;
    const inW = ov(m[0], m[1], W.open, W.close);
    const inH = ov(m[0], m[1], Math.max(W.open, h.open), Math.min(W.close, h.close));
    if (r.category === "maint") { st.avail -= inW; st.availIn -= inH; continue; }
    st.planned += inW; st.plannedIn += inH;
    if (r.status === "used") st.actual += inW;
    catMin[r.category] = (catMin[r.category] ?? 0) + (m[1] - m[0]);
    HEAT_HOURS.forEach((hr, i) => { heat[weekday(s.date)][i] += ov(m[0], m[1], hr * 60, hr * 60 + 60); });
  }

  const rooms = [...rs.values()];
  const total = rooms.reduce((t, x) => ({ avail: t.avail + x.avail, availIn: t.availIn + x.availIn, planned: t.planned + x.planned,
    plannedIn: t.plannedIn + x.plannedIn, actual: t.actual + x.actual, revenue: t.revenue + x.revenue }),
    { avail: 0, availIn: 0, planned: 0, plannedIn: 0, actual: 0, revenue: 0 });
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
  return { days, rooms, total, catMin, heat, heatDays, heatHours: HEAT_HOURS, revenue, sources: sorted(src), schools: sorted(sch) };
}

/** 割合（0〜1）。分母 0 は null */
export const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export const pct = (r: number | null, digits = 1) => (r == null ? "—" : `${(r * 100).toFixed(digits)}%`);
/** 月の前後 */
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
