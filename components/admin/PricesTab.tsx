"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { explain, fetchHallExtras, yen, type HallExtra, type PriceSettings } from "@/lib/admin";
import { Button, Field, Notice, SectionTitle, inputCls } from "@/components/ui";

/** 料金設定とホールの追加楽器。変更は「これから保存する予約」に反映（過去の予約の料金は変わらない） */
export default function PricesTab() {
  const [s, setS] = useState<PriceSettings | null>(null);
  const [extras, setExtras] = useState<HallExtra[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from("price_settings").select("base_per_hour, add_per_person, hall_per_hour, tax_rate, public_charge").eq("id", 1).single<PriceSettings>(),
      fetchHallExtras(),
    ]);
    if (a.error || b.error) setError(explain(a.error ?? b.error));
    setS(a.data ?? null);
    setExtras(b.data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setError(""); setInfo("");
    const { error } = await supabase.from("price_settings").update({
      base_per_hour: Math.max(0, Math.round(s.base_per_hour)), add_per_person: Math.max(0, Math.round(s.add_per_person)),
      hall_per_hour: Math.max(0, Math.round(s.hall_per_hour)), tax_rate: Math.min(100, Math.max(0, Math.round(s.tax_rate))),
      public_charge: s.public_charge }).eq("id", 1);
    if (error) return setError(explain(error));
    setInfo("保存しました。これから保存する予約に使われます（すでに入っている予約の料金は変わりません）。");
  }

  async function saveExtra(x: HallExtra) {
    setError(""); setInfo("");
    const { error } = await supabase.from("hall_extras").update({ name: x.name.trim(), price: Math.max(0, Math.round(x.price)), unit: x.unit, active: x.active, sort_order: x.sort_order }).eq("id", x.id);
    if (error) return setError(explain(error));
    setInfo(`「${x.name}」を保存しました。`);
    load();
  }
  async function addExtra() {
    const name = prompt("追加する楽器・設備の名前");
    if (!name?.trim()) return;
    const { error } = await supabase.from("hall_extras").insert({ name: name.trim(), price: 0, unit: "hour", sort_order: (extras.at(-1)?.sort_order ?? 0) + 1 });
    if (error) return setError(error.code === "23505" ? "同じ名前の楽器がすでにあります。" : explain(error));
    load();
  }
  async function removeExtra(x: HallExtra) {
    if (!confirm(`「${x.name}」を削除しますか？\n（過去の予約に記録された名前は残ります。一時的に止めるなら「使う」のチェックを外してください）`)) return;
    const { error } = await supabase.from("hall_extras").delete().eq("id", x.id);
    if (error) return setError(explain(error));
    load();
  }
  const edit = (id: number, p: Partial<HallExtra>) => setExtras((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const num = (k: keyof Omit<PriceSettings, "public_charge">, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input type="number" min={0} inputMode="numeric" value={s?.[k] ?? ""} onChange={(e) => s && setS({ ...s, [k]: Number(e.target.value) })} className={`${inputCls} tabular-nums`} />
    </Field>
  );

  return (
    <div className="space-y-8 px-4 py-4 md:px-0">
      {error && <Notice>{error}</Notice>}
      {info && <Notice tone="info">{info}</Notice>}
      <section>
        <SectionTitle>料金設定（一般貸出）</SectionTitle>
        {s && (
          <form onSubmit={saveSettings} className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {num("base_per_hour", "一般教室 基本料金（円/時・税抜）")}
              {num("add_per_person", "2人目以降の追加（円/人/時）")}
              {num("hall_per_hour", "ホール 基本料金（円/時・税抜）")}
              {num("tax_rate", "消費税率（%）")}
            </div>
            <p className="text-xs text-neutral-500 tabular-nums">
              例：一般教室 2人 1時間30分 → ({yen(s.base_per_hour)} ＋ {yen(s.add_per_person)}) × 1.5 ＝ 税抜 {yen(Math.round((s.base_per_hour + s.add_per_person) * 1.5))}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={s.public_charge} onChange={(e) => setS({ ...s, public_charge: e.target.checked })} className="mt-0.5 size-5 shrink-0 accent-[#2f55c4]" />
              <span>一般の予約画面（LINE から）の予約を有料にする<span className="block text-xs text-neutral-500">オフにすると、一般の予約は「無料・0円」で入ります（受付で変更できます）。</span></span>
            </label>
            <Button type="submit" variant="primary" className="w-full md:w-auto">料金設定を保存</Button>
          </form>
        )}
      </section>

      <section>
        <SectionTitle right={<Button className="h-9" onClick={addExtra}>楽器を追加</Button>}>ホールの追加楽器・設備</SectionTitle>
        <ul className="divide-y divide-neutral-200 border-b border-neutral-200">
          {extras.map((x) => (
            <li key={x.id} className="grid grid-cols-2 items-end gap-2 py-3 md:grid-cols-[minmax(0,2fr)_8rem_10rem_auto_auto_auto]">
              <Field label="名前" className="col-span-2 md:col-span-1"><input value={x.name} maxLength={40} onChange={(e) => edit(x.id, { name: e.target.value })} className={inputCls} /></Field>
              <Field label="料金（円・税抜）"><input type="number" min={0} inputMode="numeric" value={x.price} onChange={(e) => edit(x.id, { price: Number(e.target.value) })} className={`${inputCls} tabular-nums`} /></Field>
              <Field label="単位">
                <select value={x.unit} onChange={(e) => edit(x.id, { unit: e.target.value as HallExtra["unit"] })} className={inputCls}>
                  <option value="hour">1時間あたり</option><option value="once">1回あたり</option>
                </select>
              </Field>
              <label className="flex h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={x.active} onChange={(e) => edit(x.id, { active: e.target.checked })} className="size-5 accent-[#2f55c4]" />使う
              </label>
              <Button className="h-11" onClick={() => saveExtra(x)}>保存</Button>
              <Button variant="danger" className="h-11" onClick={() => removeExtra(x)}>削除</Button>
            </li>
          ))}
          {!extras.length && <li className="py-6 text-center text-sm text-neutral-500">ありません</li>}
        </ul>
      </section>
    </div>
  );
}
