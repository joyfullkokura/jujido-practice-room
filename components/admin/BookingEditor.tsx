"use client";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtDate, toISO } from "@/lib/date";
import { fmtLen, fmtMin } from "@/lib/types";
import { CATEGORIES, CATEGORY_KEYS, PAYMENTS, PAYMENT_KEYS, STATUSES, STATUS_KEYS, defaultPayment, isActive, type Category, type Payment, type Status } from "@/lib/booking";
import { describe, explain, fmtStamp, sourceLabel, type ReservationRow, type RoomRow } from "@/lib/admin";
import BottomSheet from "@/components/BottomSheet";
import { Badge, Button, Field, Notice, inputCls } from "@/components/ui";

/** フォームの中身（新規・編集共通） */
export type Draft = {
  id?: number; date: string; room_id: number; start: number; end: number;
  category: Category; name: string; school: string; teacher: string; course: string; people: number;
  contact: string; staff: string; note: string; payment: Payment; status: Status;
  discount: number; price_override: number | null;
  source?: string | null; created_at?: string;
};

export function newDraft(p: { date: string; room_id: number; start: number; end: number; staff: string }): Draft {
  return { ...p, category: "lesson", name: "", school: "", teacher: "", course: "", people: 1, contact: "", note: "",
    payment: defaultPayment("lesson"), status: "confirmed", discount: 0, price_override: null };
}
export function draftOf(r: ReservationRow): Draft {
  const d = describe(r);
  return { id: r.id, date: d.date, room_id: r.room_id, start: d.start, end: d.end, category: r.category, name: r.name,
    school: r.school ?? "", teacher: r.teacher ?? "", course: r.course ?? "", people: r.people, contact: r.contact ?? "",
    staff: r.staff ?? "", note: r.note ?? "", payment: r.payment, status: r.status, discount: r.discount,
    price_override: r.price_override, source: r.source, created_at: r.created_at };
}

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
  const set = (p: Partial<Draft>) => { setError(""); setD((x) => ({ ...x, ...p })); };
  const isNew = !d.id;
  const room = rooms.find((r) => r.id === d.room_id);

  const starts = useMemo(() => { const a = []; for (let m = range.open; m < range.close; m += 15) a.push(m); return a; }, [range]);
  const ends = useMemo(() => { const a = []; for (let m = d.start + 15; m <= Math.max(range.close, d.start + 15); m += 15) a.push(m); return a; }, [d.start, range]);

  // 警告（保存はできるもの）と、重なり（DB が拒否するもの）
  const warnings: string[] = [];
  const h = hoursOf(d.date);
  if (!h) warnings.push("この日は定休日です。");
  else if (d.start < h.open || d.end > h.close) warnings.push(`営業時間（${fmtMin(h.open)}〜${fmtMin(h.close)}）の外です。`);
  const cl = closedOf(d.room_id, d.date).filter((c) => c.start < d.end && d.start < c.end);
  if (cl.length) warnings.push(`予約不可枠（${cl.map((c) => c.label ?? "予約不可").join("・")}）にかかっています。`);
  if (room && d.people > (room.capacity ?? Infinity)) warnings.push(`定員（${room.capacity}人）を超えています。`);
  const conflicts = d.status === "cancelled" ? [] : others.filter((o) => o.id !== d.id && o.room_id === d.room_id && isActive(o)
    && (() => { const x = describe(o); return x.date === d.date && x.start < d.end && d.start < x.end; })());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!d.name.trim()) return setError("利用者名・団体名を入力してください。");
    if (d.end <= d.start) return setError("終了は開始より後にしてください。");
    if (conflicts.length) return setError("ほかの予約と重なっています。時間か部屋を変えてください。");
    if (warnings.length && !confirm(`${warnings.join("\n")}\n\nこのまま登録しますか？`)) return;
    const body = {
      room_id: d.room_id, start_at: toISO(d.date, d.start), end_at: toISO(d.date, d.end),
      category: d.category, name: d.name.trim(), school: d.school.trim() || null, teacher: d.teacher.trim() || null,
      course: d.course.trim() || null, people: Math.max(1, Math.round(d.people || 1)), contact: d.contact.trim() || null,
      staff: d.staff.trim() || null, note: d.note.trim() || null, payment: d.payment, status: d.status,
      discount: Math.max(0, Math.round(d.discount || 0)), price_override: d.price_override,
    };
    setSaving(true);
    const { error } = isNew
      ? await supabase.from("reservations").insert({ ...body, source: "admin" })
      : await supabase.from("reservations").update(body).eq("id", d.id!);
    setSaving(false);
    if (error) return setError(explain(error));
    onSaved(d.date);
  }

  async function quick(patch: Record<string, unknown>, ask: string) {
    if (!confirm(ask)) return;
    const { error } = await supabase.from("reservations").update(patch).eq("id", d.id!);
    if (error) return setError(explain(error));
    onSaved(d.date);
  }

  const text = (k: "name" | "school" | "teacher" | "course" | "contact" | "staff", max: number) => (
    <input value={d[k]} maxLength={max} onChange={(e) => set({ [k]: e.target.value })} className={inputCls} />
  );

  return (
    <BottomSheet wide onClose={onClose} label={isNew ? "新規予約" : "予約の編集"}>
      <form onSubmit={save} className="space-y-5 pt-1">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">{isNew ? "新規予約" : "予約の編集"}</h2>
          {!isNew && <Badge tone={d.status === "cancelled" ? "red" : "accent"}>{STATUSES[initial.status]}</Badge>}
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
          <Field label="備考" className="col-span-2 md:col-span-4">
            <textarea value={d.note} maxLength={500} rows={2} onChange={(e) => set({ note: e.target.value })}
              className={`${inputCls} h-auto py-2`} />
          </Field>
        </section>

        {!isNew && (
          <p className="text-xs text-neutral-500 tabular-nums">
            予約ID {d.id}　流入元 {sourceLabel(d.source ?? null) || "—"}　作成 {fmtStamp(d.created_at ?? null)}
          </p>
        )}

        <div className="space-y-2">
          {warnings.map((w) => <Notice key={w} tone="info">{w}</Notice>)}
          {conflicts.length > 0 && (
            <Notice>重複：{conflicts.map((o) => `${describe(o).time} ${o.name}`).join("、")}</Notice>
          )}
          {error && <Notice>{error}</Notice>}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-4">
          <Button type="submit" variant="primary" disabled={saving} className="min-w-32">
            {saving ? "保存中…" : `${fmtDate(d.date)} ${fmtMin(d.start)}〜${fmtMin(d.end)} で保存`}
          </Button>
          <Button onClick={onClose}>閉じる</Button>
          {!isNew && initial.status !== "cancelled" && (
            <Button variant="danger" className="md:ml-auto" onClick={() => quick({ status: "cancelled" }, `${initial.name} さんの予約をキャンセル扱いにしますか？`)}>キャンセル扱い</Button>
          )}
          {!isNew && (
            <Button variant="danger" onClick={() => quick({ deleted_at: new Date().toISOString() }, "この予約を削除しますか？\n予約表・一覧・集計から消えます（通常は「キャンセル扱い」を使ってください）。")}>削除</Button>
          )}
        </div>
      </form>
    </BottomSheet>
  );
}

