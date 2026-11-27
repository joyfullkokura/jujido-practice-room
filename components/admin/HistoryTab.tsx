"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { WEEKDAYS, fromISO, toISO } from "@/lib/date";
import { fmtMin } from "@/lib/types";
import { CATEGORIES, PAYMENTS, STATUSES } from "@/lib/booking";
import { explain, sourceLabel, yen, type RoomRow } from "@/lib/admin";
import { Button, Field, Notice, SectionTitle, inputCls } from "@/components/ui";

type Entry = {
  id: number; at: string; actor_email: string | null; actor_kind: "admin" | "public" | "system";
  table_name: string; row_id: string | null; action: "insert" | "update" | "delete";
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
};

const TABLES: Record<string, string> = {
  reservations: "予約", rooms: "部屋", closures: "予約不可", business_hours: "営業時間",
  price_settings: "料金設定", hall_extras: "ホールの楽器", shop_settings: "集計の時間帯",
};
const ACTIONS = { insert: "追加", update: "変更", delete: "削除" } as const;
/** 表示する項目と名前（ここにない列は履歴の画面には出さない。DB には残っている） */
const FIELDS: Record<string, string> = {
  room_id: "部屋", start_at: "開始", end_at: "終了", category: "区分", status: "予約状況", name: "名前", school: "学校名",
  teacher: "講師", course: "コース", people: "人数", contact: "連絡先", staff: "受付担当", note: "備考", payment: "支払状況",
  extras: "追加楽器", discount: "割引", price_override: "料金の手動修正", price_total: "料金（税込）", deleted_at: "削除",
  source: "流入元", color: "色", capacity: "定員", description: "説明", sort_order: "並び順", is_public: "公開",
  instruments: "常設楽器", is_hall: "ホール", target_rate: "目標稼働率(%)", sales_target: "売上目標", reason: "理由",
  open_time: "開店", close_time: "閉店", is_closed: "定休日", base_per_hour: "基本料金/時", add_per_person: "2人目以降/人/時",
  hall_per_hour: "ホール料金/時", tax_rate: "消費税率(%)", public_charge: "一般予約を有料", price: "料金", unit: "単位", active: "使う",
  analysis_open: "集計の開始", analysis_close: "集計の終了",
};
const MONEY = new Set(["discount", "price_override", "price_total", "sales_target", "base_per_hour", "add_per_person", "hall_per_hour", "price"]);
const PAGE = 50;
const isBlank = (k: string, v: unknown) => v == null || v === "" || (Array.isArray(v) && !v.length) || (k === "discount" && v === 0);

export default function HistoryTab({ rooms }: { rooms: RoomRow[] }) {
  const [table, setTable] = useState("");
  const [until, setUntil] = useState("");
  const [list, setList] = useState<Entry[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (offset: number) => {
    let q = supabase.from("audit_log").select("id, at, actor_email, actor_kind, table_name, row_id, action, before, after")
      .order("at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE - 1);
    if (table) q = q.eq("table_name", table);
    if (until) q = q.lt("at", toISO(until, 24 * 60));
    const { data, error } = await q.returns<Entry[]>();
    if (error) return setError(explain(error));
    setError("");
    setList((xs) => (offset ? [...xs, ...(data ?? [])] : data ?? []));
    setMore((data?.length ?? 0) === PAGE);
  }, [table, until]);
  useEffect(() => { load(0); }, [load]);

  const fmt = (k: string, v: unknown): string => {
    if (v == null || v === "") return "—";
    if (k === "room_id") return rooms.find((r) => r.id === v)?.name ?? `#${v}`;
    if (k === "category") return CATEGORIES[v as keyof typeof CATEGORIES]?.label ?? String(v);
    if (k === "status") return STATUSES[v as keyof typeof STATUSES] ?? String(v);
    if (k === "payment") return PAYMENTS[v as keyof typeof PAYMENTS] ?? String(v);
    if (k === "source") return sourceLabel(String(v));
    if (k === "unit") return v === "hour" ? "1時間あたり" : "1回あたり";
    if (k === "deleted_at") return "削除";
    if (typeof v === "boolean") return v ? "はい" : "いいえ";
    if (Array.isArray(v)) return v.length ? v.join("・") : "—";
    if (MONEY.has(k) && typeof v === "number") return yen(v);
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) { const d = fromISO(v); return `${d.date.slice(5).replace("-", "/")} ${fmtMin(d.min)}`; }
    if (typeof v === "string" && /^\d{2}:\d{2}:\d{2}$/.test(v)) return v.slice(0, 5);
    return String(v);
  };
  const who = (e: Entry) => (e.actor_kind === "public" ? "一般の予約画面" : e.actor_kind === "system" ? "SQL Editor（システム）" : e.actor_email ?? "管理者");
  const target = (e: Entry) => {
    const r = (e.after ?? e.before ?? {}) as Record<string, unknown>;
    if (e.table_name === "business_hours") return `${WEEKDAYS[Number(e.row_id)]}曜日`;
    if (e.table_name === "reservations") return `#${e.row_id}${r.name ? ` ${r.name}` : ""}`;
    if (e.table_name === "rooms" || e.table_name === "hall_extras") return String(r.name ?? `#${e.row_id}`);
    return e.row_id && e.row_id !== "1" ? `#${e.row_id}` : "";
  };

  return (
    <div className="space-y-4">
      <SectionTitle>変更履歴</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:max-w-xl">
        <Field label="対象">
          <select value={table} onChange={(e) => setTable(e.target.value)} className={inputCls}>
            <option value="">すべて</option>
            {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="この日まで"><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={`${inputCls} tabular-nums`} /></Field>
      </div>
      {error && <Notice>{error}</Notice>}
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200" aria-label="変更履歴">
        {list.map((e) => {
          const src = (e.action === "update" ? e.after : e.after ?? e.before) ?? {};
          // 追加・削除は値の入っている項目だけ
          const keys = Object.keys(src).filter((k) => FIELDS[k] && (e.action === "update" || (k !== "deleted_at" && !isBlank(k, src[k]))));
          return (
            <li key={e.id} className="py-2.5 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
                <span className="text-neutral-500">{fmt("at", e.at)}</span>
                <span className="font-semibold">{TABLES[e.table_name] ?? e.table_name}{target(e) && `　${target(e)}`}を{e.action === "update" && e.after && "deleted_at" in e.after && e.after.deleted_at ? "削除" : ACTIONS[e.action]}</span>
                <span className="text-xs text-neutral-500">{who(e)}</span>
              </p>
              {keys.length > 0 && (
                <p className="mt-0.5 text-xs text-neutral-600">
                  {keys.map((k) => (
                    <span key={k} className="mr-3 inline-block">
                      {FIELDS[k]}：{e.action === "update" ? <>{fmt(k, e.before?.[k])} → <b className="text-neutral-900">{fmt(k, e.after?.[k])}</b></> : fmt(k, (e.after ?? e.before)?.[k])}
                    </span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
        {!list.length && !error && <li className="py-6 text-center text-sm text-neutral-500">履歴はまだありません</li>}
      </ul>
      {more && <Button onClick={() => load(list.length)}>さらに表示</Button>}
    </div>
  );
}
