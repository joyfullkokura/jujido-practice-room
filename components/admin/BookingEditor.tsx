"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, fmtDate, nowJST, toISO } from "@/lib/date";
import { fmtLen, fmtMin } from "@/lib/types";
import { CATEGORIES, CATEGORY_KEYS, PAYMENTS, PAYMENT_KEYS, STATUSES, STATUS_KEYS, defaultPayment, isActive, type Category, type Payment, type Status } from "@/lib/booking";
import { describe, explain, fetchHallExtras, fmtStamp, quotePrice, sourceLabel, yen, type HallExtra, type Quote, type ReservationRow, type RoomRow } from "@/lib/admin";
import BottomSheet from "@/components/BottomSheet";
import { Badge, Button, Field, Notice, inputCls } from "@/components/ui";

/** フォームの中身（新規・編集共通） */
export type Draft = {
  id?: number; date: string; room_id: number; start: number; end: number;
  category: Category; name: string; school: string; teacher: string; course: string; people: number;
  contact: string; staff: string; note: string; payment: Payment; status: Status;
  extras: string[]; discount: number; price_override: number | null;
  source?: string | null; created_at?: string; series_id?: string | null;
};

export function newDraft(p: { date: string; room_id: number; start: number; end: number; staff: string } & Partial<Draft>): Draft {
  const category = p.category ?? "lesson";
  return { category, name: "", school: "", teacher: "", course: "", people: 1, contact: "", note: "",
    payment: defaultPayment(category), status: "confirmed", extras: [], discount: 0, price_override: null, ...p };
}
export function draftOf(r: ReservationRow): Draft {
  const d = describe(r);
  return { id: r.id, date: d.date, room_id: r.room_id, start: d.start, end: d.end, category: r.category, name: r.name,
    school: r.school ?? "", teacher: r.teacher ?? "", course: r.course ?? "", people: r.people, contact: r.contact ?? "",
    staff: r.staff ?? "", note: r.note ?? "", payment: r.payment, status: r.status, extras: r.extras ?? [], discount: r.discount,
    price_override: r.price_override, source: r.source, created_at: r.created_at, series_id: r.series_id };
}

type SeriesRow = { day: string; ok: boolean; reason: string | null; id: number | null };
const opt = (m: number) => <option key={m} value={m}>{fmtMin(m)}</option>;

export default function BookingEditor({ initial, rooms, others, hoursOf, closedOf, range, onClose, onSaved }: {
  initial: Draft; rooms: RoomRow[];
  /** 同じ日のほかの予約（重なりの事前チェック用） */
  others: ReservationRow[];
  hoursOf: (date: string) => { open: number; close: number } | null;
  closedOf: (roomId: number, date: string) => { start: number; end: number; label?: string }[];
  range: { open: number; close: number };
  onClose: () => void; onSaved: (date: string) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [paymentTouched, setPaymentTouched] = useState(!!initial.id);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [master, setMaster] = useState<HallExtra[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [repeat, setRepeat] = useState<0 | 7 | 14>(0);
  const [until, setUntil] = useState(addDays(initial.date, 84));
  const [plan, setPlan] = useState<SeriesRow[] | null>(null);
  const [done, setDone] = useState<SeriesRow[] | null>(null);
  const set = (p: Partial<Draft>) => { setError(""); setPlan(null); setD((x) => ({ ...x, ...p })); };
  const isNew = !d.id;
  const room = rooms.find((r) => r.id === d.room_id);

  useEffect(() => { fetchHallExtras().then(({ data }) => setMaster(data ?? [])); }, []);

  // 料金は DB の関数で計算（保存時・CSV と同じ結果）
  const qKey = JSON.stringify([d.category, d.room_id, d.date, d.start, d.end, d.people, d.extras, d.discount, d.price_override]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const q = await quotePrice({ category: d.category, room_id: d.room_id, start_at: toISO(d.date, d.start), end_at: toISO(d.date, d.end),
        people: Math.max(1, Math.round(d.people || 1)), extras: room?.is_hall ? d.extras : [], discount: Math.max(0, Math.round(d.discount || 0)),
        price_override: d.price_override });
      if (live) setQuote(q);
    }, 250);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey, room?.is_hall]);

  const starts = useMemo(() => { const a = []; for (let m = range.open; m < range.close; m += 15) a.push(m); return a; }, [range]);
  const ends = useMemo(() => { const a = []; for (let m = d.start + 15; m <= Math.max(range.close, d.start + 15); m += 15) a.push(m); return a; }, [d.start, range]);

  // 注意（保存はできるもの）と、重なり（DB が拒否するもの）
  const warnings: string[] = [];
  const h = hoursOf(d.date);
  if (!h) warnings.push("この日は定休日です。");
  else if (d.start < h.open || d.end > h.close) warnings.push(`営業時間（${fmtMin(h.open)}〜${fmtMin(h.close)}）の外です。`);
  const cl = closedOf(d.room_id, d.date).filter((c) => c.start < d.end && d.start < c.end);
  if (cl.length) warnings.push(`予約不可枠（${cl.map((c) => c.label ?? "予約不可").join("・")}）にかかっています。`);
  if (room && d.people > (room.capacity ?? Infinity)) warnings.push(`定員（${room.capacity}人）を超えています。`);
  const conflicts = d.status === "cancelled" ? [] : others.filter((o) => o.id !== d.id && o.room_id === d.room_id && isActive(o)
    && (() => { const x = describe(o); return x.date === d.date && x.start < d.end && d.start < x.end; })());

  const fields = () => ({
    category: d.category, name: d.name.trim(), school: d.school.trim() || null, teacher: d.teacher.trim() || null,
    course: d.course.trim() || null, people: Math.max(1, Math.round(d.people || 1)), contact: d.contact.trim() || null,
    staff: d.staff.trim() || null, note: d.note.trim() || null, payment: d.payment, status: d.status,
    extras: room?.is_hall ? d.extras : [], discount: Math.max(0, Math.round(d.discount || 0)), price_override: d.price_override,
  });
  const check = () => {
    if (!d.name.trim()) return "利用者名・団体名を入力してください。";
    if (d.end <= d.start) return "終了は開始より後にしてください。";
    return "";
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const bad = check();
    if (bad) return setError(bad);
    if (repeat) return runSeries(true);
    if (conflicts.length) return setError("ほかの予約と重なっています。時間か部屋を変えてください。");
    if (warnings.length && !confirm(`${warnings.join("\n")}\n\nこのまま登録しますか？`)) return;
    const body = { room_id: d.room_id, start_at: toISO(d.date, d.start), end_at: toISO(d.date, d.end), ...fields() };
    setSaving(true);
    const { error } = isNew
      ? await supabase.from("reservations").insert({ ...body, source: "admin" })
      : await supabase.from("reservations").update(body).eq("id", d.id!);
    setSaving(false);
    if (error) return setError(explain(error));
    onSaved(d.date);
  }

  /** 定期レッスン：dry=true で確認だけ、false で登録 */
  async function runSeries(dry: boolean) {
    if (until < d.date) return setError("繰り返しの終了日は利用日より後にしてください。");
    setSaving(true);
    const { data, error } = await supabase.rpc("create_series", {
      p_room_id: d.room_id, p_first: d.date, p_start_min: d.start, p_end_min: d.end, p_every_days: repeat, p_until: until,
      p_fields: fields(), p_dry_run: dry });
    setSaving(false);
    if (error) return setError(explain(error));
    if (dry) setPlan(data as SeriesRow[]);
    else { setPlan(null); setDone(data as SeriesRow[]); }
  }

  async function quick(patch: Record<string, unknown>, ask: string) {
    if (!confirm(ask)) return;
    const { error } = await supabase.from("reservations").update(patch).eq("id", d.id!);
    if (error) return setError(explain(error));
    onSaved(d.date);
  }

  async function deleteSeries() {
    const today = nowJST().date;
    const { count } = await supabase.from("reservations").select("id", { count: "exact", head: true })
      .eq("series_id", d.series_id!).is("deleted_at", null).gte("start_at", toISO(today, 0));
    if (!confirm(`この定期レッスンの今日以降の予約 ${count ?? 0}件 をすべて削除しますか？\n（今日より前の予約は残ります）`)) return;
    const { error } = await supabase.from("reservations").update({ deleted_at: new Date().toISOString() })
      .eq("series_id", d.series_id!).is("deleted_at", null).gte("start_at", toISO(today, 0));
    if (error) return setError(explain(error));
    onSaved(d.date);
  }

  const text = (k: "name" | "school" | "teacher" | "course" | "contact" | "staff", max: number) => (
    <input value={d[k]} maxLength={max} onChange={(e) => set({ [k]: e.target.value })} className={inputCls} />
  );
  const extrasShown = master.filter((x) => x.active || d.extras.includes(x.name));

  // 定期レッスンの登録結果
  if (done) {
    const ng = done.filter((r) => !r.ok);
    return (
      <BottomSheet wide onClose={() => onSaved(d.date)} label="定期レッスンの登録結果">
        <div className="space-y-4 pt-1">
          <h2 className="text-xl font-bold">定期レッスンを登録しました</h2>
          <p className="text-sm tabular-nums">登録 {done.length - ng.length}件{ng.length > 0 && <span className="text-red-700">　登録しなかった日 {ng.length}件</span>}</p>
          {ng.length > 0 && <SeriesList rows={ng} />}
          <Button variant="primary" className="w-full md:w-auto" onClick={() => onSaved(d.date)}>閉じる</Button>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet wide onClose={onClose} label={isNew ? "新規予約" : "予約の編集"}>
      <form onSubmit={save} className="space-y-5 pt-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">{isNew ? "新規予約" : "予約の編集"}</h2>
          {!isNew && <Badge tone={d.status === "cancelled" ? "red" : "accent"}>{STATUSES[initial.status]}</Badge>}
          {d.series_id && <Badge>定期</Badge>}
        </div>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="利用日" className="col-span-2 md:col-span-1">
            <input type="date" value={d.date} onChange={(e) => e.target.value && set({ date: e.target.value })} className={`${inputCls} tabular-nums`} />
          </Field>
          <Field label="部屋" className="col-span-2 md:col-span-1">
            <select value={d.room_id} onChange={(e) => set({ room_id: Number(e.target.value) })} className={inputCls}>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.is_public ? "" : "（非公開）"}</option>)}
            </select>
          </Field>
          <Field label="開始">
            <select aria-label="開始時刻" value={d.start} className={`${inputCls} tabular-nums`}
              onChange={(e) => { const s = Number(e.target.value); set({ start: s, end: Math.max(s + 15, s + (d.end - d.start)) }); }}>
              {starts.map(opt)}
            </select>
          </Field>
          <Field label="終了" hint={fmtLen(d.end - d.start)}>
            <select aria-label="終了時刻" value={d.end} onChange={(e) => set({ end: Number(e.target.value) })} className={`${inputCls} tabular-nums`}>
              {ends.map(opt)}
            </select>
          </Field>
          {isNew && (
            <>
              <Field label="繰り返し">
                <select aria-label="繰り返し" value={repeat} onChange={(e) => { setPlan(null); setRepeat(Number(e.target.value) as 0 | 7 | 14); }} className={inputCls}>
                  <option value={0}>なし</option><option value={7}>毎週</option><option value={14}>隔週</option>
                </select>
              </Field>
              {repeat > 0 && (
                <Field label="繰り返しの終了日">
                  <input type="date" value={until} min={d.date} onChange={(e) => { setPlan(null); setUntil(e.target.value); }} className={`${inputCls} tabular-nums`} />
                </Field>
              )}
            </>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="予約区分" className="col-span-2">
            <select value={d.category} className={inputCls} onChange={(e) => {
              const c = e.target.value as Category;
              set(paymentTouched ? { category: c } : { category: c, payment: defaultPayment(c) });
            }}>
              {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
            </select>
          </Field>
          <Field label="予約状況">
            <select value={d.status} onChange={(e) => set({ status: e.target.value as Status })} className={inputCls}>
              {STATUS_KEYS.map((k) => <option key={k} value={k}>{STATUSES[k]}</option>)}
            </select>
          </Field>
          <Field label="支払状況">
            <select value={d.payment} onChange={(e) => { setPaymentTouched(true); set({ payment: e.target.value as Payment }); }} className={inputCls}>
              {PAYMENT_KEYS.map((k) => <option key={k} value={k}>{PAYMENTS[k]}</option>)}
            </select>
          </Field>
          <Field label="利用者名・団体名（必須）" className="col-span-2">{text("name", 50)}</Field>
          <Field label="学校名" className="col-span-2">{text("school", 50)}</Field>
          <Field label="講師">{text("teacher", 40)}</Field>
          <Field label="コース">{text("course", 40)}</Field>
          <Field label="人数">
            <input type="number" min={1} max={200} inputMode="numeric" value={d.people}
              onChange={(e) => set({ people: Number(e.target.value) })} className={`${inputCls} tabular-nums`} />
          </Field>
          <Field label="受付担当">{text("staff", 40)}</Field>
          <Field label="連絡先（任意・管理者のみ閲覧）" className="col-span-2">
            <input value={d.contact} maxLength={60} inputMode="tel" onChange={(e) => set({ contact: e.target.value })} className={inputCls} />
          </Field>
          <Field label="割引（円・税抜）">
            <input type="number" min={0} inputMode="numeric" value={d.discount} onChange={(e) => set({ discount: Number(e.target.value) })} className={`${inputCls} tabular-nums`} />
          </Field>
          <Field label="料金の手動修正（税抜）" hint="空欄なら自動計算">
            <input type="number" min={0} inputMode="numeric" value={d.price_override ?? ""}
              onChange={(e) => set({ price_override: e.target.value === "" ? null : Number(e.target.value) })} className={`${inputCls} tabular-nums`} />
          </Field>
          {room?.is_hall && (
            <fieldset className="col-span-2 md:col-span-4">
              <legend className="mb-1 text-sm font-semibold text-neutral-700">ホールの追加楽器・設備</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {extrasShown.map((x) => (
                  <label key={x.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-5 accent-[#2f55c4]" checked={d.extras.includes(x.name)}
                      onChange={(e) => set({ extras: e.target.checked ? [...d.extras, x.name] : d.extras.filter((n) => n !== x.name) })} />
                    {x.name}<span className="text-xs text-neutral-500 tabular-nums">{yen(x.price)}/{x.unit === "hour" ? "時間" : "回"}</span>
                  </label>
                ))}
                {!extrasShown.length && <span className="text-sm text-neutral-500">「料金」タブで楽器を登録してください</span>}
              </div>
            </fieldset>
          )}
          <Field label="備考" className="col-span-2 md:col-span-4">
            <textarea value={d.note} maxLength={500} rows={2} onChange={(e) => set({ note: e.target.value })}
              className={`${inputCls} h-auto py-2`} />
          </Field>
        </section>

        <PriceBox quote={quote} category={d.category} discount={d.discount} override={d.price_override} />

        {!isNew && (
          <p className="text-xs text-neutral-500 tabular-nums">
            予約ID {d.id}　流入元 {sourceLabel(d.source ?? null) || "—"}　作成 {fmtStamp(d.created_at ?? null)}
          </p>
        )}

        <div className="space-y-2">
          {!repeat && warnings.map((w) => <Notice key={w} tone="info">{w}</Notice>)}
          {!repeat && conflicts.length > 0 && (
            <Notice>重複：{conflicts.map((o) => `${describe(o).time} ${o.name}`).join("、")}</Notice>
          )}
          {error && <Notice>{error}</Notice>}
        </div>

        {plan && (
          <div className="space-y-3 border border-neutral-200 p-3" data-testid="series-plan">
            <p className="text-sm font-semibold tabular-nums">
              {repeat === 7 ? "毎週" : "隔週"} {fmtDate(d.date)}〜{fmtDate(until)}：登録できる {plan.filter((r) => r.ok).length}件
              {plan.some((r) => !r.ok) && <span className="text-red-700">　登録しない {plan.filter((r) => !r.ok).length}件</span>}
            </p>
            {plan.some((r) => !r.ok) && <SeriesList rows={plan.filter((r) => !r.ok)} />}
            <Button variant="primary" disabled={saving || !plan.some((r) => r.ok)} onClick={() => runSeries(false)}>
              {saving ? "登録中…" : `${plan.filter((r) => r.ok).length}件を登録する`}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-4">
          {!plan && (
            <Button type="submit" variant="primary" disabled={saving} className="min-w-32">
              {saving ? "処理中…" : repeat ? "登録する日を確認" : `${fmtDate(d.date)} ${fmtMin(d.start)}〜${fmtMin(d.end)} で保存`}
            </Button>
          )}
          <Button onClick={onClose}>閉じる</Button>
          {!isNew && initial.status !== "cancelled" && (
            <Button variant="danger" className="md:ml-auto" onClick={() => quick({ status: "cancelled" }, `${initial.name} さんの予約をキャンセル扱いにしますか？`)}>キャンセル扱い</Button>
          )}
          {!isNew && (
            <Button variant="danger" onClick={() => quick({ deleted_at: new Date().toISOString() }, "この予約を削除しますか？\n予約表・一覧・集計から消えます（通常は「キャンセル扱い」を使ってください）。")}>削除</Button>
          )}
          {!isNew && d.series_id && (
            <Button variant="danger" onClick={deleteSeries}>この定期を今日以降すべて削除</Button>
          )}
        </div>
      </form>
    </BottomSheet>
  );
}

function SeriesList({ rows }: { rows: SeriesRow[] }) {
  return (
    <ul className="divide-y divide-neutral-200 border-y border-neutral-200 text-sm" aria-label="登録しない日">
      {rows.map((r) => (
        <li key={r.day} className="flex gap-3 py-1.5"><span className="w-28 shrink-0 tabular-nums">{fmtDate(r.day)}</span><span className="text-neutral-600">{r.reason}</span></li>
      ))}
    </ul>
  );
}

function PriceBox({ quote, category, discount, override }: { quote: Quote | null; category: Category; discount: number; override: number | null }) {
  if (!quote) return <p className="text-sm text-neutral-500">料金を計算中…</p>;
  return (
    <div className="border-y border-neutral-200 py-3" data-testid="price">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm tabular-nums">
        <span className="text-neutral-600">基本 {yen(quote.base)}</span>
        <span className="text-neutral-600">追加 {yen(quote.extras)}</span>
        {discount > 0 && override == null && <span className="text-neutral-600">割引 −{yen(discount)}</span>}
        {override != null && <span className="text-neutral-600">手動修正</span>}
        <span>税抜 <b>{yen(quote.net)}</b></span>
        <span className="text-neutral-600">消費税 {yen(quote.tax)}</span>
        <span className="text-base">税込 <b>{yen(quote.total)}</b></span>
      </div>
      {category !== "rental" && override == null && (
        <p className="mt-1 text-xs text-neutral-500">料金がかかるのは一般貸出だけです（必要なら「料金の手動修正」に入力）。</p>
      )}
    </div>
  );
}
