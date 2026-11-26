"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, dayNum, isPast, monthNum, nowJST, weekOf, weekday, yearNum, WEEKDAYS } from "@/lib/date";
import { CLOSE_HOUR, MAX_HOURS, toBlocks, type Room, type Selection, type Slot } from "@/lib/types";
import CalendarGrid from "@/components/CalendarGrid";
import BookingSheet from "@/components/BookingSheet";


/** 幅768px未満ならスマホ（1日表示） */
function useIsMobile() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia("(max-width: 767px)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}

export default function Home() {
  const isMobile = useIsMobile();
  const [now, setNow] = useState<{ date: string; hour: number } | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomFilter, setRoomFilter] = useState<number | "all">("all");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const source = useRef<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);

  // 日付・時刻はブラウザ側で決める（ビルド時の日付にならないように）
  useEffect(() => {
    const n = nowJST();
    setNow(n);
    setAnchor(n.date);
    source.current = new URLSearchParams(location.search).get("from"); // QRごとの流入元
    const t = setInterval(() => setNow(nowJST()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ヘッダーの高さを CSS 変数に（曜日見出しをその下に固定するため）
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [now]);

  const week = useMemo(() => (anchor ? weekOf(anchor) : []), [anchor]);
  const days = useMemo(() => (anchor ? (isMobile ? [anchor] : week) : []), [anchor, isMobile, week]);
  const from = days[0], to = days[days.length - 1];

  // 部屋の一覧（公開中のものだけが返る）
  useEffect(() => {
    supabase.from("rooms").select("id, name, color, capacity, description, sort_order")
      .order("sort_order").order("id")
      .then(({ data, error }) => { if (error) setLoadError(true); else setRooms(data ?? []); });
  }, []);

  const shownRooms = useMemo(
    () => (roomFilter === "all" ? rooms : rooms.filter((r) => r.id === roomFilter)), [rooms, roomFilter]);

  const load = useCallback(async () => {
    if (!from || !to) return;
    const { data, error } = await supabase.from("booked_slots")
      .select("room_id, date, start_hour, group_id")
      .gte("date", from).lte("date", to);
    setLoadError(!!error);
    if (!error) setSlots(data ?? []);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);
  // アプリに戻ってきたら最新の空き状況に
  useEffect(() => {
    const f = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [load]);

  const blocks = useMemo(() => {
    const ids = new Set(shownRooms.map((r) => r.id));
    return toBlocks(slots.filter((s) => ids.has(s.room_id)));
  }, [slots, shownRooms]);
  const isBooked = useCallback((roomId: number, date: string, h: number) =>
    slots.some((s) => s.room_id === roomId && s.date === date && s.start_hour === h), [slots]);
  /** その時間に空いている部屋（表示中の部屋のうち） */
  const freeRooms = useCallback((date: string, h: number) =>
    shownRooms.filter((r) => !isBooked(r.id, date, h)), [shownRooms, isBooked]);
  const isFull = useCallback((date: string, h: number) => freeRooms(date, h).length === 0, [freeRooms]);

  /** 開始時刻から連続して空いている終了時刻の候補 */
  const endOptions = useCallback((roomId: number, date: string, start: number) => {
    const out: number[] = [];
    for (let end = start + 1; end <= Math.min(start + MAX_HOURS, CLOSE_HOUR); end++) {
      if (isBooked(roomId, date, end - 1)) break;
      out.push(end);
    }
    return out;
  }, [isBooked]);

  // 移動：スマホは1日、PCは1週間
  const step = isMobile ? 1 : 7;
  const move = (n: number) => { setSelection(null); setAnchor((a) => (a ? addDays(a, n * step) : a)); };
  const goToday = () => { setSelection(null); if (now) setAnchor(now.date); };

  // スマホの左右スワイプ
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!isMobile || !touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
  };

  if (!now || !anchor) return <div className="min-h-dvh bg-white" />;

  const selectedRoom = selection ? rooms.find((r) => r.id === selection.roomId) : undefined;

  const monthLabel = (() => {
    const a = days[0], b = days[days.length - 1];
    const y = `${yearNum(a)}年`;
    return monthNum(a) === monthNum(b) ? `${y}${monthNum(a)}月` : `${y}${monthNum(a)}月〜${monthNum(b)}月`;
  })();

  return (
    <div className="min-h-dvh bg-white" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header ref={headerRef} className="sticky top-0 z-30 border-b border-neutral-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-3 pb-3 md:px-8">
          <p className="text-xs text-neutral-500">十字堂楽器店 練習室予約</p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="mr-auto text-xl font-bold tabular-nums md:text-2xl">{monthLabel}</h1>
            <button onClick={goToday}
              className="h-9 rounded-sm border border-neutral-300 px-3 text-sm font-medium text-neutral-800 active:bg-neutral-100">
              今日
            </button>
            <div className="flex">
              <NavButton label={isMobile ? "前の日" : "前の週"} onClick={() => move(-1)} dir="prev" />
              <NavButton label={isMobile ? "次の日" : "次の週"} onClick={() => move(1)} dir="next" />
            </div>
          </div>

          {/* スマホ：週の日付を横に並べて、タップで日付を切り替え */}
          {isMobile && (
            <div className="-mb-3 mt-3 grid grid-cols-7">
              {week.map((d) => {
                const active = d === anchor, today = d === now.date, wd = weekday(d);
                return (
                  <button key={d} onClick={() => { setSelection(null); setAnchor(d); }}
                    className={`flex flex-col items-center border-b-2 pt-1 pb-2 ${active ? "border-accent" : "border-transparent"}`}>
                    <span className={`text-xs ${wd === 0 ? "text-red-600" : wd === 6 ? "text-accent" : "text-neutral-500"}`}>
                      {WEEKDAYS[wd]}
                    </span>
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
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-2 pb-24 md:px-8">
        {rooms.length > 1 && (
          <div className="-mx-2 flex overflow-x-auto border-b border-neutral-200 px-2 [scrollbar-width:none]">
            <RoomChip active={roomFilter === "all"} onClick={() => { setSelection(null); setRoomFilter("all"); }}>すべて</RoomChip>
            {rooms.map((r) => (
              <RoomChip key={r.id} active={roomFilter === r.id} color={r.color}
                onClick={() => { setSelection(null); setRoomFilter(r.id); }}>
                {r.name}
              </RoomChip>
            ))}
          </div>
        )}
        <p className="px-2 py-3 text-sm text-neutral-600">
          {roomFilter !== "all" && shownRooms[0]?.description ? `${shownRooms[0].description}・` : ""}
          空いている時間をタップして予約できます
        </p>
        {loadError && (
          <p className="mx-2 mb-3 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">
            空き状況を読み込めませんでした。通信状況を確認してください。
          </p>
        )}
        <CalendarGrid days={days} blocks={blocks} rooms={shownRooms} selection={selection} now={now} isFull={isFull}
          onPick={(date, h) => {
            const free = freeRooms(date, h);
            if (isPast(date, h, now) || free.length === 0) return;
            setSelection({ date, start: h, end: h + 1, roomId: free[0].id });
          }} />
        <Legend rooms={shownRooms} />
      </main>

      {selection && selectedRoom && (
        <BookingSheet
          selection={selection}
          endOptions={endOptions(selection.roomId, selection.date, selection.start)}
          room={selectedRoom}
          roomOptions={freeRooms(selection.date, selection.start)}
          source={source.current}
          onChangeEnd={(end) => setSelection({ ...selection, end })}
          onChangeRoom={(roomId) => {
            // 部屋を変えたら、その部屋で取れる長さに合わせる
            const ends = endOptions(roomId, selection.date, selection.start);
            setSelection({ ...selection, roomId, end: Math.min(selection.end, ends[ends.length - 1] ?? selection.start + 1) });
          }}
          onClose={() => setSelection(null)}
          onBooked={load}
        />
      )}
    </div>
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

function RoomChip({ active, color, onClick, children }: {
  active: boolean; color?: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
      className={`-mb-px flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm ${
        active ? "border-accent font-semibold text-neutral-900" : "border-transparent text-neutral-600"}`}>
      {color && <i className="size-2 rounded-xs" style={{ background: color }} />}
      {children}
    </button>
  );
}

function Legend({ rooms }: { rooms: Room[] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 px-2 text-xs text-neutral-600">
      <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-xs border border-neutral-300 bg-white" />空き</span>
      {rooms.map((r) => (
        <span key={r.id} className="flex items-center gap-1.5">
          <i className="size-2.5 rounded-xs border-l-2" style={{ borderLeftColor: r.color, background: r.color + "1a" }} />
          {rooms.length > 1 ? `${r.name} 予約済` : "予約済"}
        </span>
      ))}
      <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-xs bg-neutral-100" />受付終了</span>
      <span className="flex items-center gap-1.5"><i className="h-px w-3 bg-red-600" />現在時刻</span>
    </div>
  );
}
