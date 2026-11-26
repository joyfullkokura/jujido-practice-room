"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 下から出るシート。
 * - つまみ部分、または中身が一番上までスクロールされている状態から下にドラッグすると指についてくる
 * - 一定距離(120px)かスピード(0.5px/ms)を超えたら閉じる。超えなければ元に戻る
 * - 背景クリック・Esc キーでも閉じる
 */
export default function BottomSheet({ onClose, label, children }: {
  onClose: () => void; label: string; children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);

  const close = useCallback(() => {
    setDragging(false);
    setClosing(true);
    setTimeout(onClose, 200);
  }, [onClose]);

  // 背景のスクロールを止める・Esc で閉じる
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [close]);

  // ドラッグ（touchmove で preventDefault するため、passive: false のネイティブリスナーを使う）
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    let startY = 0, lastY = 0, lastT = 0, velocity = 0;
    let mode: "idle" | "maybe" | "drag" = "idle";

    const onStart = (e: TouchEvent) => {
      const onHandle = handleRef.current?.contains(e.target as Node);
      const atTop = (scrollRef.current?.scrollTop ?? 0) <= 0;
      if (!onHandle && !atTop) { mode = "idle"; return; }
      mode = "maybe";
      startY = lastY = e.touches[0].clientY;
      lastT = e.timeStamp;
      velocity = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (mode === "idle") return;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      if (mode === "maybe") {
        if (dy < 0) { mode = "idle"; return; }   // 上方向は普通のスクロール
        if (dy < 4) return;
        mode = "drag";
        setDragging(true);
      }
      e.preventDefault();
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (y - lastY) / dt;
      lastY = y; lastT = e.timeStamp;
      setDragY(Math.max(0, dy));
    };
    const onEnd = () => {
      if (mode !== "drag") { mode = "idle"; return; }
      mode = "idle";
      const dy = lastY - startY;
      if (dy > 120 || (velocity > 0.5 && dy > 30)) close();
      else { setDragging(false); setDragY(0); }
    };
    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onEnd);
    return () => {
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onEnd);
    };
  }, [close]);

  const height = sheetRef.current?.offsetHeight ?? 600;
  const offset = closing ? "100%" : `${dragY}px`;
  const backdrop = closing ? 0 : Math.max(0, 1 - dragY / height);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={label}>
      <button aria-label="閉じる" tabIndex={-1} onClick={close}
        className="animate-fade-in absolute inset-0 bg-black/40"
        style={{ opacity: backdrop, transition: dragging ? "none" : "opacity 0.2s" }} />
      <div ref={sheetRef}
        className="animate-sheet-up relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-md border-t border-neutral-200 bg-white"
        style={{ transform: `translateY(${offset})`, transition: dragging ? "none" : "transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
        {/* つまみ（ここを持って下げると閉じる） */}
        <div ref={handleRef} className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center">
          <span className="h-1 w-9 rounded-xs bg-neutral-300" />
        </div>
        <div ref={scrollRef} className="overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
