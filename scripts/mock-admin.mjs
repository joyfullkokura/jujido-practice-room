// 管理画面のテスト・スクリーンショット用：ログイン済みの管理者とサンプルデータを通信のモックで再現する（DB には触れない）
export const DAY = "2026-11-27";
export const t = (hm, d = DAY) => `${d}T${hm}:00+09:00`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", exp: 4102444800, role: "authenticated", email: "admin@example.com" })}.x`;
export const session = {
  access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "r",
  user: { id: "u1", aud: "authenticated", role: "authenticated", email: "admin@example.com", app_metadata: {}, user_metadata: {}, created_at: t("09:00") },
};

const room = (id, name, color, o = {}) => ({ id, name, color, capacity: 4, description: null, sort_order: id, is_public: false,
  instruments: null, is_hall: false, target_rate: 40, sales_target: 20000, ...o });
export const ROOMS = [
  room(1, "2階 練習室A", "#4f7a87", { capacity: 5, is_public: true, description: "ドラムセット" }),
  room(2, "2階 練習室B", "#8a6474", { capacity: 3, is_public: true }),
  room(3, "L-1", "#7a7a52", { instruments: "アップライトピアノ" }),
  room(4, "M-3", "#5b6f8f", { instruments: "グランドピアノ、ステージア ELS-01C" }),
  room(5, "ホール", "#6b6b6b", { capacity: 30, instruments: "グランドピアノ", is_hall: true }),
];

let seq = 0;
export const R = (room_id, s, e, name, o = {}) => ({
  id: ++seq, room_id, start_at: t(s), end_at: t(e), name, school: null, source: "admin", status: "confirmed",
  created_at: t("08:12", "2026-11-25"), cancelled_at: null, category: "rental", teacher: null, course: null, people: 1,
  contact: null, staff: null, note: null, payment: "unpaid", extras: [], discount: 0, price_override: null, deleted_at: null,
  price_base: 0, price_extras: 0, price_net: 0, price_tax: 0, price_total: 0, series_id: null, ...o,
});
// 練習室A: 11:00-12:30 仮予約（一般貸出）、17:15-18:45 確定 ／ B: 13:00-14:00 メンテナンス ／ L-1: 16:00-17:00 レッスン
export const RESERVATIONS = [
  R(1, "11:00", "12:30", "山田 太郎", { status: "tentative", school: "○○中学校", source: "○○中", price_net: 1500, price_total: 1650 }),
  R(1, "17:15", "18:45", "佐藤 花子", { school: "△△高校", source: "△△高", payment: "paid", price_net: 1500, price_total: 1650 }),
  R(2, "13:00", "14:00", "ピアノ調律", { category: "maint", payment: "free" }),
  R(3, "16:00", "17:00", "生徒 12", { category: "lesson", teacher: "高山", course: "ピアノ初級", payment: "free", series_id: "s1" }),
  R(3, "17:00", "18:00", "生徒 5", { category: "pass", teacher: "三吉", payment: "free", status: "used" }),
  R(4, "10:00", "11:30", "体験 鈴木", { category: "trial", teacher: "戸嶋", payment: "free" }),
  R(5, "13:00", "15:00", "発表会リハーサル", { category: "event", people: 12, payment: "unpaid" }),
  R(4, "15:00", "16:00", "田中 次郎", { status: "cancelled", cancelled_at: t("09:30") }),
];
export const SETTINGS = { base_per_hour: 1000, add_per_person: 100, hall_per_hour: 1500, tax_rate: 10, public_charge: true };
export const EXTRAS = [
  { id: 1, name: "グランドピアノ", price: 500, unit: "hour", sort_order: 1, active: true },
  { id: 2, name: "その他打楽器", price: 300, unit: "once", sort_order: 2, active: true },
];
/** quote_price と同じ計算（モック用） */
export function quote(rooms, b) {
  const h = (Date.parse(b.p_end_at) - Date.parse(b.p_start_at)) / 3600e3, S = SETTINGS;
  let base = 0, ex = 0;
  if (b.p_category === "rental") {
    if (rooms.find((r) => r.id === b.p_room_id)?.is_hall) {
      base = S.hall_per_hour * h;
      ex = EXTRAS.filter((x) => (b.p_extras ?? []).includes(x.name)).reduce((a, x) => a + x.price * (x.unit === "hour" ? h : 1), 0);
    } else base = (S.base_per_hour + Math.max(0, (b.p_people ?? 1) - 1) * S.add_per_person) * h;
  }
  base = Math.round(base); ex = Math.round(ex);
  const net = Math.max(0, b.p_override ?? base + ex - (b.p_discount ?? 0)), tax = Math.round((net * S.tax_rate) / 100);
  return [{ base, extras: ex, net, tax, total: net + tax }];
}
/** create_series のモック：2回目は重複、3回目は定休日 */
const series = (b) => {
  const out = [];
  for (let i = 0, d = b.p_first; d <= b.p_until; i++, d = new Date(Date.parse(d + "T00:00:00Z") + b.p_every_days * 864e5).toISOString().slice(0, 10)) {
    const reason = i === 1 ? "重複：16:00〜17:00 生徒 3" : i === 2 ? "定休日" : null;
    out.push({ day: d, ok: !reason, reason, id: reason || b.p_dry_run ? null : 1000 + i });
  }
  return out;
};
export const SHOP = { analysis_open: "09:00:00", analysis_close: "21:00:00" };
const A = (id, at, kind, email, table_name, row_id, action, before, after) => ({ id, at: t(at), actor_kind: kind, actor_email: email, table_name, row_id, action, before, after });
export const AUDIT = [
  A(5, "10:05", "admin", "admin@example.com", "reservations", "8", "update", { status: "confirmed", cancelled_at: null }, { status: "cancelled", cancelled_at: t("10:05") }),
  A(4, "09:40", "public", null, "reservations", "1", "insert", null,
    { id: 1, room_id: 1, start_at: t("11:00"), end_at: t("12:30"), name: "山田 太郎", school: "○○中学校", category: "rental", status: "tentative", people: 1, payment: "unpaid", extras: [], discount: 0, price_total: 1650, source: "○○中" }),
  A(3, "09:30", "admin", "admin@example.com", "price_settings", "1", "update", { tax_rate: 8 }, { tax_rate: 10 }),
  A(2, "09:20", "admin", "admin@example.com", "business_hours", "0", "update", { is_closed: false }, { is_closed: true }),
  A(1, "09:00", "system", null, "rooms", "3", "insert", null, { id: 3, name: "L-1", capacity: 4, is_public: false, instruments: "アップライトピアノ" }),
];
export const CLOSURES = [{ id: 1, room_id: null, start_at: t("20:00"), end_at: t("21:00"), reason: "店の都合" }];

/** ログイン済みの管理者として /admin を開く */
export async function openAdmin(page, url, { rooms = ROOMS, reservations = RESERVATIONS, closures = CLOSURES, hours = [] } = {}) {
  await page.route(/\/auth\/v1\/token/, (r) => r.fulfill({ json: session }));
  await page.route(/\/auth\/v1\/user/, (r) => r.fulfill({ json: session.user }));
  await page.route(/\/rest\/v1\/rpc\/is_admin/, (r) => r.fulfill({ json: true }));
  await page.route(/\/rest\/v1\/rpc\/quote_price/, (r) => r.fulfill({ json: quote(rooms, r.request().postDataJSON()) }));
  await page.route(/\/rest\/v1\/rpc\/create_series/, (r) => r.fulfill({ json: series(r.request().postDataJSON()) }));
  await page.route(/\/rest\/v1\/rpc\/search_free_rooms/, (r) => r.fulfill({ json: rooms.filter((x) => x.id !== 1).map((x) => ({ room_id: x.id, name: x.name,
    instruments: x.instruments, capacity: x.capacity, is_hall: x.is_hall, is_public: x.is_public, total: quote(rooms, { p_category: "rental", p_room_id: x.id,
      p_start_at: t("10:00"), p_end_at: t("11:00"), p_people: 1 })[0].total })) }));
  await page.route(/\/rest\/v1\/hall_extras/, (r) => r.fulfill({ json: EXTRAS }));
  await page.route(/\/rest\/v1\/shop_settings/, (r) => r.request().method() === "GET" ? r.fulfill({ json: SHOP }) : r.fulfill({ status: 204 }));
  await page.route(/\/rest\/v1\/audit_log/, (r) => r.fulfill({ json: AUDIT }));
  await page.route(/\/rest\/v1\/price_settings/, (r) => r.fulfill({ json: SETTINGS }));
  await page.route(/\/rest\/v1\/rooms/, (r) => r.fulfill({ json: rooms }));
  await page.route(/\/rest\/v1\/reservations/, (r) => r.request().method() === "GET" ? r.fulfill({ json: reservations }) : r.fulfill({ status: 201, json: [] }));
  await page.route(/\/rest\/v1\/closures/, (r) => r.fulfill({ json: closures }));
  await page.route(/\/rest\/v1\/business_hours/, (r) => r.fulfill({ json: hours }));
  await page.goto(`${url}/admin`, { waitUntil: "networkidle" });
  await page.getByLabel("メールアドレス").fill("admin@example.com");
  await page.getByLabel("パスワード").fill("x");
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.locator("[data-timeline]").waitFor();
  await page.waitForTimeout(300);
}
