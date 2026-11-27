"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { fetchAllRooms, type RoomRow } from "@/lib/admin";
import { Button, Field, Notice, inputCls } from "@/components/ui";
import DayTab from "@/components/admin/DayTab";
import ListTab from "@/components/admin/ListTab";
import ClosuresTab from "@/components/admin/ClosuresTab";
import RoomsTab from "@/components/admin/RoomsTab";
import HoursTab from "@/components/admin/HoursTab";

const TABS = [
  { key: "day", label: "予約表" },
  { key: "list", label: "一覧・CSV" },
  { key: "closures", label: "予約不可" },
  { key: "rooms", label: "部屋" },
  { key: "hours", label: "営業時間" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default function AdminPage() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // 管理者かどうかは DB の is_admin() で確認（画面の表示を切り替えるだけ。実際の権限は RLS が判定）
  useEffect(() => {
    if (!session) { setIsAdmin(null); return; }
    supabase.rpc("is_admin").then(({ data }) => setIsAdmin(data === true));
  }, [session]);

  if (session === undefined) return <div className="min-h-dvh bg-white" />;
  if (!session) return <Login />;
  if (isAdmin === null) return <div className="min-h-dvh bg-white" />;
  if (!isAdmin) {
    return (
      <Centered>
        <h1 className="text-lg font-bold">管理者ではありません</h1>
        <p className="mt-2 text-sm text-neutral-600">{session.user.email} には管理者の権限がありません。</p>
        <Button className="mt-6 w-full" onClick={() => supabase.auth.signOut()}>ログアウト</Button>
      </Centered>
    );
  }
  return <AdminShell email={session.user.email ?? ""} />;
}

function AdminShell({ email }: { email: string }) {
  const [tab, setTab] = useState<Tab>("day");
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const reloadRooms = useCallback(async () => {
    const { data } = await fetchAllRooms();
    setRooms(data ?? []);
  }, []);
  useEffect(() => { reloadRooms(); }, [reloadRooms]);

  // ヘッダーの高さを CSS 変数に（予約グリッドの見出しをその下に固定するため）
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="min-h-dvh bg-white">
      <header ref={headerRef} className="sticky top-0 z-30 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-3 md:px-8">
          <div className="mr-auto min-w-0">
            <p className="text-xs text-neutral-500">十字堂楽器店 練習室予約</p>
            <h1 className="text-lg font-bold">管理</h1>
          </div>
          <span className="hidden truncate text-xs text-neutral-500 sm:block">{email}</span>
          <Button variant="ghost" className="h-9 px-2" onClick={() => supabase.auth.signOut()}>ログアウト</Button>
        </div>
        <nav className="mx-auto flex max-w-6xl overflow-x-auto px-2 [scrollbar-width:none] md:px-6">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} aria-current={tab === t.key ? "page" : undefined}
              className={`-mb-px h-11 shrink-0 border-b-2 px-3 text-sm ${
                tab === t.key ? "border-accent font-semibold text-neutral-900" : "border-transparent text-neutral-600"}`}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl pb-24 md:px-8">
        {tab === "day" && <DayTab rooms={rooms} staff={email.split("@")[0]} />}
        {tab === "list" && <ListTab rooms={rooms} />}
        {tab === "closures" && <ClosuresTab rooms={rooms} />}
        {tab === "rooms" && <RoomsTab rooms={rooms} reload={reloadRooms} />}
        {tab === "hours" && <HoursTab />}
      </main>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSending(false);
    if (error) setError("メールアドレスかパスワードが違います。");
  }
  return (
    <Centered>
      <p className="text-xs text-neutral-500">十字堂楽器店 練習室予約</p>
      <h1 className="text-lg font-bold">管理者ログイン</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="メールアドレス">
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Field>
        <Field label="パスワード">
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </Field>
        {error && <Notice>{error}</Notice>}
        <Button type="submit" variant="primary" className="w-full" disabled={sending}>{sending ? "ログイン中…" : "ログイン"}</Button>
      </form>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-start justify-center bg-white px-4 pt-[18vh]">
      <div className="w-full max-w-sm border border-neutral-200 p-6">{children}</div>
    </div>
  );
}
