"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button, Field, Notice, SectionTitle, inputCls } from "@/components/ui";

/** ログイン画面に「パスワードを変更しました」と出すための印（ログアウト後に1回だけ読む） */
export const PW_CHANGED_KEY = "jujido-admin-pw-changed";

/**
 * ログイン中の管理者が自分のパスワードを変える。
 * 今のパスワードで本人確認 → auth.updateUser（service_role key は使わない）→ ログアウトして入り直してもらう。
 * 管理者の追加・削除はここではできない（SQL Editor からだけ）。
 */
export default function AccountTab({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!current) return setError("今のパスワードを入力してください。");
    if (next.length < 8) return setError("新しいパスワードは8文字以上にしてください。");
    if (next !== again) return setError("新しいパスワードと確認用が一致しません。");
    if (next === current) return setError("今と同じパスワードには変更できません。");
    setBusy(true);
    // 本人確認：今のパスワードでログインし直せるか
    const { error: ve } = await supabase.auth.signInWithPassword({ email, password: current });
    if (ve) { setBusy(false); return setError("今のパスワードが違います。"); }
    const { error: ue } = await supabase.auth.updateUser({ password: next });
    if (ue) {
      setBusy(false);
      if (ue.code === "weak_password") return setError("新しいパスワードが弱すぎます。英字・数字を組み合わせて長めにしてください。");
      if (ue.code === "same_password") return setError("今と同じパスワードには変更できません。");
      if (ue.code === "reauthentication_needed") return setError("この設定では、メールでの確認が必要です。Supabase の Authentication 設定を確認してください。");
      return setError(`変更できませんでした（${ue.message}）`);
    }
    try { sessionStorage.setItem(PW_CHANGED_KEY, "1"); } catch {}
    await supabase.auth.signOut();
  }

  return (
    <div className="space-y-6 px-4 py-4 md:px-0">
      <section className="space-y-2">
        <SectionTitle>ログイン中のアカウント</SectionTitle>
        <p className="text-sm"><span className="text-neutral-500">メールアドレス</span>　<span className="font-semibold">{email}</span></p>
        <p className="text-xs text-neutral-500">管理者の追加・削除は、安全のため Supabase の SQL Editor からだけ行えます。</p>
      </section>

      <section className="space-y-4">
        <SectionTitle>パスワードの変更</SectionTitle>
        <form onSubmit={submit} className="space-y-4 md:max-w-md">
          <Field label="今のパスワード">
            <input aria-label="今のパスワード" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputCls} />
          </Field>
          <Field label="新しいパスワード" hint="8文字以上">
            <input aria-label="新しいパスワード" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputCls} />
          </Field>
          <Field label="新しいパスワード（確認用）">
            <input aria-label="新しいパスワード（確認用）" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={inputCls} />
          </Field>
          {error && <Notice>{error}</Notice>}
          <Button type="submit" variant="primary" disabled={busy} className="w-full md:w-auto">{busy ? "変更中…" : "パスワードを変更する"}</Button>
          <p className="text-xs text-neutral-500">変更すると、いったんログアウトします。新しいパスワードでログインし直してください。</p>
        </form>
      </section>
    </div>
  );
}
