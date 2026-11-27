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
  contact: null, staff: null, note: null, payment: "unpaid", extras: [], discount: 0, price_override: null, deleted_at: null, ...o,
});
// 練習室A: 11:00-12:30 仮予約（一般貸出）、17:15-18:45 確定 ／ B: 13:00-14:00 メンテナンス ／ L-1: 16:00-17:00 レッスン
export const RESERVATIONS = [
  R(1, "11:00", "12:30", "山田 太郎", { status: "tentative", school: "○○中学校", source: "○○中" }),
  R(1, "17:15", "18:45", "佐藤 花子", { school: "△△高校", source: "△△高" }),
  R(2, "13:00", "14:00", "ピアノ調律", { category: "maint", payment: "free" }),
  R(3, "16:00", "17:00", "生徒 12", { category: "lesson", teacher: "高山", course: "ピアノ初級", payment: "free" }),
  R(3, "17:00", "18:00", "生徒 5", { category: "pass", teacher: "三吉", payment: "free", status: "used" }),
  R(4, "10:00", "11:30", "体験 鈴木", { category: "trial", teacher: "戸嶋", payment: "free" }),
  R(5, "13:00", "15:00", "発表会リハーサル", { category: "event", people: 12, payment: "unpaid" }),
  R(4, "15:00", "16:00", "田中 次郎", { status: "cancelled", cancelled_at: t("09:30") }),
];
export const CLOSURES = [{ id: 1, room_id: null, start_at: t("20:00"), end_at: t("21:00"), reason: "店の都合" }];

/** ログイン済みの管理者として /admin を開く */
export async function openAdmin(page, url, { rooms = ROOMS, reservations = RESERVATIONS, closures = CLOSURES, hours = [] } = {}) {
  await page.route(/\/auth\/v1\/token/, (r) => r.fulfill({ json: session }));
  await page.route(/\/auth\/v1\/user/, (r) => r.fulfill({ json: session.user }));
  await page.route(/\/rest\/v1\/rpc\/is_admin/, (r) => r.fulfill({ json: true }));
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
