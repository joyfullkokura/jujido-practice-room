"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { WEEKDAYS } from "@/lib/date";
import { explain } from "@/lib/admin";
import type { HoursRow } from "@/lib/useShopCalendar";
import { Button, Notice, SectionTitle, TimeSelect } from "@/components/ui";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
type Row = { weekday: number; open: number; close: number; closed: boolean };

export default function HoursTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("business_hours").select("weekday, open_time, close_time, is_closed").order("weekday")
      .then(({ data, error }) => {
        if (error) return setError(explain(error));
        setRows((data as HoursRow[]).map((r) => ({ weekday: r.weekday, open: toMin(r.open_time), close: toMin(r.close_time), closed: r.is_closed })));
      });
  }, []);

  const set = (wd: number, patch: Partial<Row>) => { setInfo(""); setRows((rs) => rs.map((r) => (r.weekday === wd ? { ...r, ...patch } : r))); };

  async function save() {
    setError(""); setInfo("");
    const bad = rows.find((r) => !r.closed && r.close <= r.open);
    if (bad) return setError(`${WEEKDAYS[bad.weekday]}曜日：閉店は開店より後にしてください。`);
    setSaving(true);
    for (const r of rows) {
      const { error } = await supabase.from("business_hours")
        .update({ open_time: toTime(r.open), close_time: toTime(r.close), is_closed: r.closed }).eq("weekday", r.weekday);
      if (error) { setSaving(false); return setError(explain(error)); }
    }
    setSaving(false);
    setInfo("保存しました。予約画面にすぐ反映されます（すでに入っている予約はそのままです）。");
  }

  // 月曜はじまりで表示
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="space-y-4 px-4 py-4 md:px-0">
      <SectionTitle>営業時間（曜日ごと）</SectionTitle>
      <ul className="divide-y divide-neutral-200 border-b border-neutral-200">
        {order.map((wd) => {
          const r = rows.find((x) => x.weekday === wd);
          if (!r) return null;
          return (
            <li key={wd} className="grid grid-cols-[2.5rem_5.5rem_1fr] items-center gap-2 py-3 md:grid-cols-[3rem_6rem_12rem_1rem_12rem]">
              <span className={`text-base font-bold ${wd === 0 ? "text-red-600" : wd === 6 ? "text-accent" : ""}`}>{WEEKDAYS[wd]}</span>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={r.closed} onChange={(e) => set(wd, { closed: e.target.checked })} className="size-5 accent-[#2f55c4]" />
                定休日
              </label>
              <div className="col-span-1 flex items-center gap-2 md:contents">
                <TimeSelect label={`${WEEKDAYS[wd]}曜の開店`} value={r.open} onChange={(m) => set(wd, { open: m })} disabled={r.closed} />
                <span className="text-neutral-400 md:text-center">〜</span>
                <TimeSelect label={`${WEEKDAYS[wd]}曜の閉店`} value={r.close} onChange={(m) => set(wd, { close: m })} disabled={r.closed} />
              </div>
            </li>
          );
        })}
      </ul>
      {error && <Notice>{error}</Notice>}
      {info && <Notice tone="info">{info}</Notice>}
      <Button variant="primary" onClick={save} disabled={saving || !rows.length} className="w-full md:w-auto">{saving ? "保存中…" : "保存する"}</Button>
    </div>
  );
}
