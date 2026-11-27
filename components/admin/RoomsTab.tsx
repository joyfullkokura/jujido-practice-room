"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { explain, type RoomRow } from "@/lib/admin";
import { Badge, Button, Field, Notice, SectionTitle, inputCls } from "@/components/ui";

/** 彩度を落とした部屋の色の候補 */
const PALETTE = ["#4f7a87", "#8a6474", "#7a7a52", "#5b6f8f", "#8a7056", "#5f7d63", "#7d6a8f", "#6b6b6b"];
type Draft = Omit<RoomRow, "id"> & { id?: number };
const empty = (order: number): Draft => ({ name: "", color: PALETTE[0], capacity: null, description: "", sort_order: order, is_public: true,
  instruments: "", is_hall: false, target_rate: 40, sales_target: 0 });

export default function RoomsTab({ rooms, reload }: { rooms: RoomRow[]; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<RoomRow | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError("");
    const body = {
      name: editing.name.trim(), color: editing.color, capacity: editing.capacity || null,
      description: editing.description?.trim() || null, sort_order: editing.sort_order, is_public: editing.is_public,
      instruments: editing.instruments?.trim() || null, is_hall: editing.is_hall,
      target_rate: Math.min(100, Math.max(0, Math.round(editing.target_rate || 0))), sales_target: Math.max(0, Math.round(editing.sales_target || 0)),
    };
    if (!body.name) return setError("部屋の名前を入力してください。");
    const { error } = editing.id
      ? await supabase.from("rooms").update(body).eq("id", editing.id)
      : await supabase.from("rooms").insert(body);
    if (error) return setError(explain(error));
    setEditing(null);
    await reload();
  }

  async function remove(r: RoomRow) {
    setError(""); setArchiveTarget(null);
    if (!confirm(`「${r.name}」を削除しますか？`)) return;
    const { error } = await supabase.from("rooms").delete().eq("id", r.id);
    if (error?.code === "23503") { setArchiveTarget(r); return setError(explain(error)); }
    if (error) return setError(explain(error));
    setEditing(null);
    await reload();
  }

  async function archive(r: RoomRow) {
    const { error } = await supabase.from("rooms").update({ is_public: false }).eq("id", r.id);
    if (error) return setError(explain(error));
    setError(""); setArchiveTarget(null); setEditing(null);
    await reload();
  }

  return (
    <div className="space-y-4 px-4 py-4 md:px-0">
      <SectionTitle right={<Button variant="primary" className="h-9" onClick={() => { setError(""); setEditing(empty((rooms.at(-1)?.sort_order ?? 0) + 1)); }}>部屋を追加</Button>}>
        部屋
      </SectionTitle>
      {error && (
        <div className="space-y-2">
          <Notice>{error}</Notice>
          {archiveTarget && <Button onClick={() => archive(archiveTarget)}>「{archiveTarget.name}」を非公開にする</Button>}
        </div>
      )}

      <ul className="divide-y divide-neutral-200 border-b border-neutral-200">
        {rooms.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-3">
            <i className="size-3 shrink-0 rounded-xs" style={{ background: r.color }} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold">{r.name}{!r.is_public && <Badge>非公開</Badge>}</p>
              <p className="truncate text-xs text-neutral-500 tabular-nums">
                並び順 {r.sort_order}{r.is_hall ? "　ホール" : ""}{r.capacity ? `　定員 ${r.capacity}人` : ""}{r.instruments ? `　${r.instruments}` : ""}{r.description ? `　${r.description}` : ""}
              </p>
            </div>
            <Button className="h-9" onClick={() => { setError(""); setEditing({ ...r }); }}>編集</Button>
          </li>
        ))}
      </ul>

      {editing && (
        <form onSubmit={save} className="space-y-4 border border-neutral-200 p-4">
          <h3 className="font-bold">{editing.id ? "部屋を編集" : "部屋を追加"}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="名前"><input value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} /></Field>
            <Field label="定員（人）"><input type="number" min={1} max={100} inputMode="numeric" value={editing.capacity ?? ""}
              onChange={(e) => setEditing({ ...editing, capacity: e.target.value ? Number(e.target.value) : null })} className={inputCls} /></Field>
            <Field label="常設楽器（空き教室検索で使います）" className="md:col-span-2"><input value={editing.instruments ?? ""} maxLength={200}
              placeholder="例：グランドピアノ、ステージア ELS-02C"
              onChange={(e) => setEditing({ ...editing, instruments: e.target.value })} className={inputCls} /></Field>
            <Field label="目標稼働率（%）"><input type="number" min={0} max={100} inputMode="numeric" value={editing.target_rate}
              onChange={(e) => setEditing({ ...editing, target_rate: Number(e.target.value) })} className={inputCls} /></Field>
            <Field label="月の貸出売上目標（円）"><input type="number" min={0} step={1000} inputMode="numeric" value={editing.sales_target}
              onChange={(e) => setEditing({ ...editing, sales_target: Number(e.target.value) })} className={inputCls} /></Field>
            <Field label="説明（一般の予約画面に表示）" className="md:col-span-2"><input value={editing.description ?? ""} maxLength={200}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={inputCls} /></Field>
            <Field label="並び順（小さいほど左）"><input type="number" inputMode="numeric" value={editing.sort_order}
              onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} className={inputCls} /></Field>
            <div>
              <span className="mb-1 block text-sm font-semibold text-neutral-700">色</span>
              <div className="flex flex-wrap items-center gap-2">
                {PALETTE.map((c) => (
                  <button key={c} type="button" aria-label={c} aria-pressed={editing.color === c} onClick={() => setEditing({ ...editing, color: c })}
                    className={`size-8 rounded-sm border-2 ${editing.color === c ? "border-neutral-900" : "border-transparent"}`} style={{ background: c }} />
                ))}
                <input type="color" aria-label="ほかの色" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded-sm border border-neutral-300 bg-white" />
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editing.is_hall} onChange={(e) => setEditing({ ...editing, is_hall: e.target.checked })} className="size-5 accent-[#2f55c4]" />
            ホール（ホール料金・追加楽器の料金を使う）
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editing.is_public} onChange={(e) => setEditing({ ...editing, is_public: e.target.checked })} className="size-5 accent-[#2f55c4]" />
            公開する（オフにすると予約画面に表示されず、新しい予約も受け付けません）
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">保存</Button>
            <Button onClick={() => setEditing(null)}>やめる</Button>
            {editing.id && <Button variant="danger" className="ml-auto" onClick={() => remove(editing as RoomRow)}>削除</Button>}
          </div>
        </form>
      )}
    </div>
  );
}
