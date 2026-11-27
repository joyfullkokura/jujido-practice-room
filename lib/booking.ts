// 区分の色は色覚の違いがあっても隣どうしを見分けられる組み合わせ（dataviz の検証スクリプトで確認済み）
// 教室管理の予約項目（区分・予約状況・支払状況）の定義。画面と CSV で同じ表示を使う

export const CATEGORIES = {
  lesson:   { label: "通常レッスン",         color: "#2a78d6" },
  rental:   { label: "一般貸出",             color: "#eb6834" },
  pass:     { label: "月イチ楽器パスポート", color: "#1baf7a" },
  trial:    { label: "無料体験",             color: "#eda100" },
  event:    { label: "イベント・発表会",     color: "#e87ba4" },
  internal: { label: "社内利用",             color: "#6250d6" },
  maint:    { label: "メンテナンス・停止",   color: "#e34948" },
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

export const STATUSES = {
  tentative: "仮予約",
  confirmed: "確定",
  used: "利用済み",
  cancelled: "キャンセル",
} as const;
export type Status = keyof typeof STATUSES;
export const STATUS_KEYS = Object.keys(STATUSES) as Status[];
/** 予約表に出す（時間を占める）状態 */
export const isActive = (r: { status: Status; deleted_at?: string | null }) => r.status !== "cancelled" && !r.deleted_at;

export const PAYMENTS = { unpaid: "未払い", paid: "支払済み", free: "無料" } as const;
export type Payment = keyof typeof PAYMENTS;
export const PAYMENT_KEYS = Object.keys(PAYMENTS) as Payment[];
/** 新しい予約の支払状況の初期値：一般貸出は未払い、それ以外は無料 */
export const defaultPayment = (c: Category): Payment => (c === "rental" ? "unpaid" : "free");
