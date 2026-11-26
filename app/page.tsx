"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, dayNum, earliestBookable, fromISO, monthNum, nowJST, toISO, weekOf, weekday, yearNum, WEEKDAYS } from "@/lib/date";
import { type Booking, type Column, type Room, type Selection } from "@/lib/types";
import { busyList, type Busy } from "@/lib/slots";
import { useShopCalendar } from "@/lib/useShopCalendar";
import TimeGrid from "@/components/TimeGrid";
import BookingSheet from "@/components/BookingSheet";

/** 幅768px未満ならスマホ */
function useIsMobile() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia("(max-width: 767px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}

type View = "day" | "week";

export default function Home() {
  const isMobile = useIsMobile();
  const [now, setNow] = useState<{ date: string; min: number } | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [viewPref, setViewPref] = useState<View>("day");
  const view: View = isMobile ? "day" : viewPref; // スマホは日表示のみ
  const [rooms, setRooms] = useState<Room[]>([]);
  const [weekRoom, setWeekRoom] = useState<number | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [picked, setPicked] = useState<{ sel: Selection; col: Column } | null>(null);
  const source = useRef<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);

  // 日付・時刻はブラウザ側で決める（ビルド時の日付にならないように）
  useEffect(() => {
    const n = nowJST();
    setNow(n);
    setAnchor(n.date);
    source.current = new URLSearchParams(location.search).get("from"); // QRごとの流入元
    const t = setInterval(() => setNow(nowJST()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ヘッダーの高さを CSS 変数に（列の見出しをその下に固定するため）
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [now]);

  // 部屋の一覧（公開中のものだけが返る）
  useEffect(() => {
    supabase.from("rooms").select("id, name, color, capacity, description, sort_order")
      .order("sort_order").order("id")
      .then(({ data, error }) => {
        if (error) return setLoadError(true);
        setRooms(data ?? []);
        setWeekRoom((w) => w ?? data?.[0]?.id ?? null);
      });
  }, []);

  const week = useMemo(() => (anchor ? weekOf(anchor) : []), [anchor]);
  const days = useMemo(() => (anchor ? (view === "day" ? [anchor] : week) : []), [anchor, view, week]);
  const from = days[0], to = days[days.length - 1];

  const load = useCallback(async () => {
    if (!from || !to) return;
    const { data, error } = await supabase.from("booked_slots")
      .select("room_id, start_at, end_at")
      .lt("start_at", toISO(addDays(to, 1), 0)).gt("end_at", toISO(from, 0));
    setLoadError(!!error);
    if (error) return;
    setBookings((data ?? []).map((b) => {
      const s = fromISO(b.start_at), e = fromISO(b.end_at);
      return { room_id: b.room_id, date: s.date, start: s.min, end: e.date === s.date ? e.min : 24 * 60 };
    }));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);
  // アプリに戻ってきたら最新の空き状況に
  useEffect(() => {
    const f = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [load]);

  // 営業時間・予約不可枠（migration 004 の前は既定値 10:00〜21:00・予約不可なし）
  const { hoursOf, closedOf, range } = useShopCalendar(from, to);

  const columns: Column[] = useMemo(() => {
    if (!anchor) return [];
    if (view === "day") return rooms.map((r) => ({ key: `r${r.id}`, roomId: r.id, date: anchor }));
    return weekRoom == null ? [] : week.map((d) => ({ key: d, roomId: weekRoom, date: d }));
  }, [anchor, view, rooms, week, weekRoom]);

  // 移動：日表示は1日、週表示は1週間
  const move = (n: number) => { setPicked(null); setAnchor((a) => (a ? addDays(a, n * (view === "day" ? 1 : 7)) : a)); };
  const goToday = () => { setPicked(null); if (now) setAnchor(now.date); };

  // スマホの左右スワイプで日付移動（部屋の列を横スクロールできるときは、スクロールを優先）
  const touch = useRef<{ x: number; y: number; scrollable: boolean } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const g = (e.target as HTMLElement).closest("[data-grid-scroll]");
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, scrollable: !!g && g.scrollWidth > g.clientWidth + 1 };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!isMobile || !t || t.scrollable || picked) return;
    const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
  };

  if (!now || !anchor) return <div className="min-h-dvh bg-white" />;

  /** その列（部屋×日）の「予約できない時間帯」 */
  const busyOf = (col: Column): Busy[] => busyList({
    booked: bookings.filter((b) => b.room_id === col.roomId && b.date === col.date),
    closed: closedOf(col.roomId, col.date),
    hours: hoursOf(col.date),
    earliest: earliestBookable(col.date, now),
  });
  const pickedRoom = picked ? rooms.find((r) => r.id === picked.sel.roomId) : undefined;

  const title = (() => {
    const a = days[0], b = days[days.length - 1];
    const y = `${yearNum(a)}年`;
    return monthNum(a) === monthNum(b) ? `${y}${monthNum(a)}月` : `${y}${monthNum(a)}月〜${monthNum(b)}月`;
  })();

  return (
    <div className="min-h-dvh bg-white" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header ref={headerRef} className="sticky top-0 z-30 border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 pt-3 pb-3 md:px-8">
          <p className="text-xs text-neutral-500">十字堂楽器店 練習室予約</p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="mr-auto text-xl font-bold tabular-nums md:text-2xl">{title}</h1>
            {!isMobile && (
              <div className="mr-2 flex" role="group" aria-label="表示の切り替え">
                {(["day", "week"] as const).map((v, i) => (
                  <button key={v} onClick={() => { setPicked(null); setViewPref(v); }} aria-pressed={view === v}
                    className={`h-9 border border-neutral-300 px-3 text-sm ${i === 0 ? "rounded-l-sm" : "-ml-px rounded-r-sm"} ${
                      view === v ? "relative z-10 border-accent bg-accent-soft font-semibold text-accent" : "text-neutral-700"}`}>
                    {v === "day" ? "日（部屋ごと）" : "週"}
                  </button>
                ))}
              </div>
            )}
            <button onClick={goToday}
              className="h-9 rounded-sm border border-neutral-300 px-3 text-sm font-medium text-neutral-800 active:bg-neutral-100">
              今日
            </button>
            <div className="flex">
              <NavButton label={view === "day" ? "前の日" : "前の週"} onClick={() => move(-1)} dir="prev" />
              <NavButton label={view === "day" ? "次の日" : "次の週"} onClick={() => move(1)} dir="next" />
            </div>
          </div>

          {/* 日表示：その週の日付を並べて、タップで日付を切り替え */}
          {view === "day" && (
            <div className="-mb-3 mt-3 grid grid-cols-7 md:max-w-xl">
              {week.map((d) => {
                const active = d === anchor, today = d === now.date, wd = weekday(d);
                return (
                  <button key={d} onClick={() => { setPicked(null); setAnchor(d); }} aria-current={active ? "date" : undefined}
                    className={`flex flex-col items-center border-b-2 pt-1 pb-2 ${active ? "border-accent" : "border-transparent"}`}>
                    <span className={`text-xs ${wd === 0 ? "text-red-600" : wd === 6 ? "text-accent" : "text-neutral-500"}`}>{WEEKDAYS[wd]}</span>
                    <span className={`text-lg leading-tight tabular-nums ${
                      active ? "font-bold text-accent" : today ? "font-bold text-neutral-900" : "font-medium text-neutral-700"}`}>
                      {dayNum(d)}
                    </span>
                    <span className={`text-[10px] leading-none ${today ? "text-neutral-500" : "text-transparent"}`}>今日</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 週表示：部屋を1つ選ぶ */}
          {view === "week" && rooms.length > 1 && (
            <div className="-mb-3 mt-2 flex overflow-x-auto [scrollbar-width:none]">
              {rooms.map((r) => (
                <button key={r.id} onClick={() => { setPicked(null); setWeekRoom(r.id); }} aria-pressed={weekRoom === r.id}
                  className={`flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm ${
                    weekRoom === r.id ? "border-accent font-semibold text-neutral-900" : "border-transparent text-neutral-600"}`}>
                  <i className="size-2 rounded-xs" style={{ background: r.color }} />{r.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl pb-24 md:px-8">
        <p className="px-4 py-3 text-sm text-neutral-600 md:px-0">
          空いている時間をタップ、または{isMobile ? "長押しして" : ""}なぞって選ぶと予約できます（15分単位・30分〜3時間）
        </p>
        {loadError && (
          <p className="mx-4 mb-3 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800 md:mx-0">
            空き状況を読み込めませんでした。通信状況を確認してください。
          </p>
        )}
        <TimeGrid columns={columns} rooms={rooms} busyOf={busyOf} range={range} now={now}
          onSelect={(col, r) => setPicked({ col, sel: { roomId: col.roomId, date: col.date, ...r } })}
          selection={picked?.sel ?? null}
          minColWidth={view === "day" ? "8.5rem" : "0px"}
          header={(c) => view === "day" ? <RoomHeader room={rooms.find((r) => r.id === c.roomId)} /> : <DayHeader date={c.date} today={now.date} />} />
        <Legend />
      </main>

      {picked && pickedRoom && (
        <BookingSheet
          selection={picked.sel} busy={busyOf(picked.col)} range={range} room={pickedRoom} source={source.current}
          onChange={(sel) => setPicked({ ...picked, sel })}
          onClose={() => setPicked(null)}
          onBooked={load}
        />
      )}
    </div>
  );
}

function RoomHeader({ room }: { room?: Room }) {
  if (!room) return null;
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-neutral-900">
        <i className="size-2 shrink-0 rounded-xs" style={{ background: room.color }} />
        <span className="truncate">{room.name}</span>
      </p>
      {room.capacity ? <p className="text-xs text-neutral-500 tabular-nums">定員 {room.capacity}人</p> : null}
    </div>
  );
}

function DayHeader({ date, today }: { date: string; today: string }) {
  const wd = weekday(date);
  return (
    <p className="flex items-baseline justify-center gap-1.5">
      <span className={`text-xs ${wd === 0 ? "text-red-600" : wd === 6 ? "text-accent" : "text-neutral-500"}`}>{WEEKDAYS[wd]}</span>
      <span className={`text-lg tabular-nums ${date === today ? "font-bold text-accent" : "font-medium text-neutral-800"}`}>{dayNum(date)}</span>
    </p>
  );
}

function NavButton({ label, onClick, dir }: { label: string; onClick: () => void; dir: "prev" | "next" }) {
  return (
    <button aria-label={label} onClick={onClick}
      className={`flex size-9 items-center justify-center border border-neutral-300 text-neutral-700 active:bg-neutral-100 ${
        dir === "prev" ? "rounded-l-sm" : "-ml-px rounded-r-sm"}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d={dir === "prev" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} />
      </svg>
    </button>
  );
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 px-4 text-xs text-neutral-600 md:px-0">
      <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-xs border border-neutral-300 bg-white" />空き</span>
      <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-xs border-l-2 border-neutral-500 bg-neutral-200" />予約済（色は部屋ごと）</span>
      <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-xs bg-neutral-100" />受付終了・予約不可</span>
      <span className="flex items-center gap-1.5"><i className="h-px w-3 bg-red-600" />現在時刻</span>
    </div>
  );
}
