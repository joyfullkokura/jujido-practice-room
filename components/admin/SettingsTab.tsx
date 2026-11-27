"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { explain, fetchWindow, type RoomRow } from "@/lib/admin";
import RoomsTab from "@/components/admin/RoomsTab";
import HoursTab from "@/components/admin/HoursTab";
import ClosuresTab from "@/components/admin/ClosuresTab";
import PricesTab from "@/components/admin/PricesTab";
import HistoryTab from "@/components/admin/HistoryTab";
import AccountTab from "@/components/admin/AccountTab";
import { Button, Field, Notice, SectionTitle, TimeSelect } from "@/components/ui";

const SUBS = [
  { key: "rooms", label: "教室" },
  { key: "hours", label: "営業時間・休業日" },
  { key: "closures", label: "臨時休業・予約不可" },
  { key: "prices", label: "料金・楽器" },
  { key: "history", label: "変更履歴" },
  { key: "account", label: "アカウント" },
] as const;
type Sub = (typeof SUBS)[number]["key"];

/** 各種設定（試作の「各種設定」に対応） */
export default function SettingsTab({ rooms, reloadRooms, email }: { rooms: RoomRow[]; reloadRooms: () => Promise<void>; email: string }) {
  const [sub, setSub] = useState<Sub>("rooms");
  return (
    <div className="md:grid md:grid-cols-[11rem_1fr] md:gap-8">
      <nav aria-label="設定の項目" className="flex overflow-x-auto border-b border-neutral-200 px-2 [scrollbar-width:none] md:flex-col md:border-r md:border-b-0 md:px-0 md:py-4">
        {SUBS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSub(s.key)} aria-current={sub === s.key ? "page" : undefined}
            className={`-mb-px h-11 shrink-0 border-b-2 px-3 text-left text-sm md:mb-0 md:-mr-px md:border-r-2 md:border-b-0 ${
              sub === s.key ? "border-accent font-semibold text-neutral-900" : "border-transparent text-neutral-600"}`}>
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        {sub === "rooms" && <RoomsTab rooms={rooms} reload={reloadRooms} />}
        {sub === "hours" && (<><HoursTab /><WindowSettings /></>)}
        {sub === "closures" && <ClosuresTab rooms={rooms} />}
        {sub === "prices" && <PricesTab />}
        {sub === "account" && <AccountTab email={email} />}
        {sub === "history" && <div className="px-4 py-4 md:px-0"><HistoryTab rooms={rooms} /></div>}
      </div>
    </div>
  );
}

/** 稼働率の分母・管理画面の予約表に使う時間帯 */
function WindowSettings() {
  const [w, setW] = useState<{ open: number; close: number } | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  useEffect(() => { fetchWindow().then(setW); }, []);
  const t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:00`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!w) return;
    setError(""); setInfo("");
    if (w.close <= w.open) return setError("終了は開始より後にしてください。");
    const { error } = await supabase.from("shop_settings").update({ analysis_open: t(w.open), analysis_close: t(w.close) }).eq("id", 1);
    if (error) return setError(explain(error));
    setInfo("保存しました。ダッシュボードの稼働率と予約表の時間帯に使われます。");
  }

  return (
    <section className="space-y-3 px-4 pb-6 md:px-0">
      <SectionTitle>集計・予約表の時間帯</SectionTitle>
      <p className="text-xs text-neutral-500">稼働率は「営業日 × この時間帯 × 部屋数」を分母に計算します（予約不可・メンテナンスの時間は除く）。管理画面の予約表もこの時間帯を表示します。</p>
      {w && (
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <Field label="開始"><TimeSelect label="集計の開始" value={w.open} onChange={(m) => setW({ ...w, open: m })} from={5 * 60} to={12 * 60} step={60} /></Field>
          <Field label="終了"><TimeSelect label="集計の終了" value={w.close} onChange={(m) => setW({ ...w, close: m })} from={15 * 60} to={24 * 60} step={60} /></Field>
          <Button type="submit" variant="primary">保存</Button>
        </form>
      )}
      {error && <Notice>{error}</Notice>}
      {info && <Notice tone="info">{info}</Notice>}
    </section>
  );
}
