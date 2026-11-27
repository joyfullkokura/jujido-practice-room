"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, earliestBookable, fmtDate, fromISO, nowJST, toISO, yearNum } from "@/lib/date";
import { type Booking, type Room, type Selection } from "@/lib/types";
import { busyList, dragRange, settleRange, tapRange, type Busy } from "@/lib/slots";
import { useShopCalendar } from "@/lib/useShopCalendar";
import Timeline, { type PickRules, type TLRow } from "@/components/Timeline";
import BookingSheet from "@/components/BookingSheet";

/** 一般の人に見せる予約済みの色（区分では色分けしない） */
const BOOKED = "#737373";

export default function Home() {
  const [now, setNow] = useState<{ date: string; min: number } | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [picked, setPicked] = useState<Selection | null>(null);
  const source = useRef<string | null>(null);

  // 日付・時刻はブラウザ側で決める（ビルド時の日付にならないように）
  useEffect(() => {
    const n = nowJST();
    setNow(n);
    setDate(n.date);
    source.current = new URLSearchParams(location.search).get("from"); // QRごとの流入元
    const t = setInterval(() => setNow(nowJST()), 30_000);
    return () => clearInterval(t);
  }, []);

  // 部屋の一覧（公開中のものだけが返る）
  useEffect(() => {
    supabase.from("rooms").select("id, name, color, capacity, description, sort_order, instruments")
      .order("sort_order").order("id")
      .then(({ data, error }) => {
        if (error) return setLoadError(true);
        setRooms(data ?? []);
      });
  }, []);

  // 予約済みの時間帯（名前・区分などは返らない）
  const load = useCallback(async () => {
    if (!date) return;
    const { data, error } = await supabase.from("booked_slots")
      .select("room_id, start_at, end_at, is_maint")
      .lt("start_at", toISO(addDays(date, 1), 0)).gt("end_at", toISO(date, 0));
    setLoadError(!!error);
    if (error) return;
    setBookings((data ?? []).map((b) => {
      const s = fromISO(b.start_at), e = fromISO(b.end_at);
      return { room_id: b.room_id, date: s.date, start: s.date === date ? s.min : 0, end: e.date === date ? e.min : 24 * 60, maint: !!b.is_maint };
    }));
  }, [date]);
  useEffect(() => { load(); }, [load]);
  // アプリに戻ってきたら最新の空き状況に
  useEffect(() => {
    const f = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [load]);

  // 営業時間・予約不可枠
  const { hoursOf, closedOf, range } = useShopCalendar(date ?? undefined, date ?? undefined);

  /** その部屋の「予約できない時間帯」（予約済・予約不可・メンテナンス・営業時間外・過ぎた時間） */
  const busyOf = useCallback((roomId: number): Busy[] => {
    if (!date || !now) return [];
    const mine = bookings.filter((b) => b.room_id === roomId);
    return busyList({
      booked: mine.filter((b) => !b.maint),
      closed: [...closedOf(roomId, date), ...mine.filter((b) => b.maint).map((b) => ({ start: b.start, end: b.end, label: "メンテナンス" }))],
      hours: hoursOf(date),
      earliest: earliestBookable(date, now),
    });
  }, [bookings, closedOf, hoursOf, date, now]);

  const rows: TLRow[] = useMemo(() => rooms.map((r) => {
    const busy = busyOf(r.id);
    return {
      id: r.id, name: r.name, note: r.instruments ?? undefined,
      // 中身は出さず「予約済」とだけ
      items: busy.filter((b) => b.kind === "booked").map((b, i) => ({ id: r.id * 1000 + i, start: b.start, end: b.end, color: BOOKED,
        tentative: false, used: false, title: "予約済", sub: "" })),
      closed: busy.filter((b) => b.kind === "closed").map((b) => ({ start: b.start, end: b.end, label: b.label })),
      unavailable: busy.filter((b) => b.kind === "past"),
    };
  }), [rooms, busyOf]);

  // 30分〜3時間・営業時間内・過ぎた時間は不可（lib/slots のルール。DB の create_reservation と同じ）
  const rules: PickRules = useMemo(() => ({
    drag: (row, a, c) => dragRange(busyOf(row.id), a, c),
    tap: (row, at) => tapRange(busyOf(row.id), at),
    settle: (row, s) => settleRange(busyOf(row.id), s.start, s.end),
  }), [busyOf]);

  if (!now || !date) return <div className="min-h-dvh bg-white" />;
  const hours = hoursOf(date);
  const pickedRoom = picked ? rooms.find((r) => r.id === picked.roomId) : undefined;
  const go = (d: string) => { setPicked(null); setDate(d); };

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 pt-3 pb-3 md:px-8">
          <p className="text-xs text-neutral-500">十字堂楽器店</p>
          <h1 className="text-xl font-bold md:text-2xl">練習室・教室の予約</h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl pb-24 md:px-8">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 md:px-0">
          <input type="date" aria-label="日付" value={date} min={now.date} onChange={(e) => e.target.value && go(e.target.value)}
            className="h-11 max-w-44 rounded-sm border border-neutral-300 bg-white px-3 text-base tabular-nums outline-none focus:border-accent focus:ring-1 focus:ring-accent" />
          <button type="button" onClick={() => go(now.date)}
            className="h-11 rounded-sm border border-neutral-300 px-4 text-sm font-semibold text-neutral-800 active:bg-neutral-100">今日</button>
          <div className="flex">
            <NavButton label="前の日" dir="prev" disabled={date <= now.date} onClick={() => go(addDays(date, -1))} />
            <NavButton label="次の日" dir="next" onClick={() => go(addDays(date, 1))} />
          </div>
          <p className="ml-auto text-base font-bold tabular-nums" aria-live="polite">
            {yearNum(date) !== yearNum(now.date) && `${yearNum(date)}年`}{fmtDate(date)}
            {date === now.date && <span className="ml-1.5 text-xs font-normal text-neutral-500">今日</span>}
            {!hours && <span className="ml-2 text-sm text-red-700">定休日</span>}
          </p>
        </div>
        <p className="px-4 pb-3 text-sm text-neutral-600 md:px-0">
          空いている時間をタップすると予約できます（15分単位・30分〜3時間）。PC はなぞって選ぶこともできます。
        </p>
        {loadError && (
          <p className="mx-4 mb-3 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800 md:mx-0">
            空き状況を読み込めませんでした。通信状況を確認してください。
          </p>
        )}

        <Timeline rows={rows} range={range} hours={hours} now={date === now.date ? now.min : null}
          selection={picked} rules={rules}
          scrollTo={{ key: date, minute: date === now.date ? now.min - 30 : (hours?.open ?? range.open) }}
          onPick={(roomId, s) => setPicked({ roomId, date, ...s })} />
        <Legend />
      </main>

      {picked && pickedRoom && (
        <BookingSheet
          selection={picked} busy={busyOf(picked.roomId)} range={range} room={pickedRoom} source={source.current}
          onChange={setPicked}
          onClose={() => setPicked(null)}
          onBooked={load}
        />
      )}
    </div>
  );
}

function NavButton({ label, onClick, dir, disabled }: { label: string; onClick: () => void; dir: "prev" | "next"; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled}
      className={`flex size-11 items-center justify-center border border-neutral-300 text-neutral-700 active:bg-neutral-100 disabled:text-neutral-300 ${
        dir === "prev" ? "rounded-l-sm" : "-ml-px rounded-r-sm"}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d={dir === "prev" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} />
      </svg>
    </button>
  );
}

function Legend() {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 px-4 text-xs text-neutral-600 md:px-0" aria-label="表示の見かた">
      <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-xs border border-neutral-300 bg-white" />空き</li>
      <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-xs border-l-[3px] bg-neutral-200" style={{ borderColor: BOOKED }} />予約済</li>
      <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-xs border border-neutral-300" style={{ backgroundImage: "repeating-linear-gradient(135deg, #eee 0 3px, #fafafa 3px 6px)" }} />予約不可・メンテナンス</li>
      <li className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-xs bg-neutral-100" />営業時間外・受付終了</li>
      <li className="flex items-center gap-1.5"><i className="h-3 w-0.5 bg-red-600" />現在時刻</li>
    </ul>
  );
}
