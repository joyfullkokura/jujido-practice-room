"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { addDays, dayNum, isPast, monthNum, nowJST, weekOf, weekday, yearNum, WEEKDAYS } from "@/lib/date";
import { CLOSE_HOUR, MAX_HOURS, toBlocks, type Selection, type Slot } from "@/lib/types";
import CalendarGrid from "@/components/CalendarGrid";
import BookingSheet from "@/components/BookingSheet";

const ROOM_ID = 1;
const ROOM_NAME = "2階 練習室";

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

  const load = useCallback(async () => {
    if (!from || !to) return;
    const { data, error } = await supabase.from("booked_slots")
      .select("room_id, date, start_hour, group_id")
      .eq("room_id", ROOM_ID).gte("date", from).lte("date", to);
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

  const blocks = useMemo(() => toBlocks(slots), [slots]);
  const isBooked = useCallback((date: string, h: number) =>
    blocks.some((b) => b.date === date && h >= b.start && h < b.end), [blocks]);

  /** 開始時刻から連続して空いている終了時刻の候補 */
  const endOptions = useCallback((date: string, start: number) => {
    const out: number[] = [];
    for (let end = start + 1; end <= Math.min(start + MAX_HOURS, CLOSE_HOUR); end++) {
      if (isBooked(date, end - 1)) break;
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

  const monthLabel = (() => {
    const a = days[0], b = days[days.length - 1];
    const y = `${yearNum(a)}年`;
    return monthNum(a) === monthNum(b) ? `${y}${monthNum(a)}月` : `${y}${monthNum(a)}月〜${monthNum(b)}月`;
  })();

  return (
    <div className="min-h-dvh bg-white" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header ref={headerRef} className="sticky top-0 z-30 border-b border-neutral-100 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 pt-4 pb-3 md:px-8">
          <p className="text-xs font-medium tracking-wider text-neutral-400">十字堂楽器店</p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="mr-auto text-xl font-bold md:text-2xl">{monthLabel}</h1>
            <button onClick={goToday}
              className="h-10 rounded-full border border-neutral-200 px-4 text-sm font-medium text-neutral-700 shadow-sm active:bg-neutral-50">
              今日
            </button>
            <NavButton label={isMobile ? "前の日" : "前の週"} onClick={() => move(-1)}>‹</NavButton>
            <NavButton label={isMobile ? "次の日" : "次の週"} onClick={() => move(1)}>›</NavButton>
          </div>

          {/* スマホ：週の日付を横に並べて、タップで日付を切り替え */}
          {isMobile && (
            <div className="mt-3 grid grid-cols-7 gap-1">
              {week.map((d) => {
                const active = d === anchor, today = d === now.date, wd = weekday(d);
                return (
                  <button key={d} onClick={() => { setSelection(null); setAnchor(d); }}
                    className={`flex flex-col items-center gap-0.5 rounded-2xl py-2 transition ${active ? "bg-accent text-white shadow-md shadow-accent/25" : ""}`}>
                    <span className={`text-xs ${active ? "opacity-90" : wd === 0 ? "text-red-500" : wd === 6 ? "text-accent" : "text-neutral-500"}`}>
                      {WEEKDAYS[wd]}
                    </span>
                    <span className={`text-lg font-bold leading-tight ${!active && today ? "text-accent" : ""}`}>{dayNum(d)}</span>
                    <span className={`size-1 rounded-full ${today ? (active ? "bg-white" : "bg-accent") : "bg-transparent"}`} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-2 pb-24 md:px-8">
        <p className="px-2 pt-4 text-sm text-neutral-500">
          {ROOM_NAME}・空いている時間をタップして予約できます
        </p>
        {loadError && (
          <p className="mx-2 mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            空き状況を読み込めませんでした。通信状況を確認してください。
          </p>
        )}
        <CalendarGrid days={days} blocks={blocks} selection={selection} now={now}
          onPick={(date, h) => {
            if (isPast(date, h, now) || isBooked(date, h)) return;
            setSelection({ date, start: h, end: h + 1 });
          }} />
        <Legend />
      </main>

      {selection && (
        <BookingSheet
          selection={selection}
          endOptions={endOptions(selection.date, selection.start)}
          roomId={ROOM_ID} roomName={ROOM_NAME} source={source.current}
          onChangeEnd={(end) => setSelection({ ...selection, end })}
          onClose={() => setSelection(null)}
          onBooked={load}
        />
      )}
    </div>
  );
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} onClick={onClick}
      className="flex size-10 items-center justify-center rounded-full text-2xl leading-none text-neutral-600 active:bg-neutral-100">
      {children}
    </button>
  );
}

function Legend() {
  return (
    <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 px-2 text-xs text-neutral-500">
      <span className="flex items-center gap-1.5"><i className="size-3 rounded border border-neutral-200 bg-white" />空き</span>
      <span className="flex items-center gap-1.5"><i className="size-3 rounded border-l-4 border-accent bg-accent-soft" />予約済</span>
      <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-neutral-100" />受付終了</span>
      <span className="flex items-center gap-1.5"><i className="h-0.5 w-3 bg-red-500" />現在時刻</span>
    </div>
  );
}
