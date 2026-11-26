// 管理画面などで使う小さな部品（角丸は最小限・影なし・区切りは1px線）
"use client";

export const inputCls =
  "h-11 w-full rounded-sm border border-neutral-300 bg-white px-3 text-base outline-none placeholder:text-neutral-400 focus:border-accent focus:ring-1 focus:ring-accent disabled:bg-neutral-50 disabled:text-neutral-400";

export function Field({ label, hint, children, className = "" }: {
  label: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-semibold text-neutral-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export function Button({ variant = "secondary", className = "", ...p }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const v = {
    primary: "bg-accent text-white active:bg-[#2647a8] border border-accent",
    secondary: "border border-neutral-300 bg-white text-neutral-800 active:bg-neutral-100",
    danger: "border border-red-300 bg-white text-red-700 active:bg-red-50",
    ghost: "text-neutral-600 active:bg-neutral-100",
  }[variant];
  return <button type="button" {...p} className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-sm px-4 text-sm font-semibold disabled:opacity-50 ${v} ${className}`} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "red"; children: React.ReactNode }) {
  const t = { neutral: "border-neutral-300 text-neutral-600", accent: "border-accent text-accent", red: "border-red-300 text-red-700" }[tone];
  return <span className={`inline-flex h-5 items-center rounded-xs border px-1.5 text-[11px] font-semibold ${t}`}>{children}</span>;
}

export function Notice({ tone = "error", children }: { tone?: "error" | "info"; children: React.ReactNode }) {
  return tone === "error"
    ? <p role="alert" className="border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{children}</p>
    : <p className="border-l-2 border-accent bg-accent-soft px-3 py-2 text-sm text-neutral-800">{children}</p>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-neutral-200 pb-2">
      <h2 className="text-base font-bold">{children}</h2>
      {right}
    </div>
  );
}

/** 15分刻みの時刻リスト */
export function TimeSelect({ value, onChange, from = 0, to = 24 * 60, label, disabled }: {
  value: number; onChange: (m: number) => void; from?: number; to?: number; label: string; disabled?: boolean;
}) {
  const opts: number[] = [];
  for (let m = from; m <= to; m += 15) opts.push(m);
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}
      className={`${inputCls} tabular-nums`}>
      {opts.map((m) => <option key={m} value={m}>{`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`}</option>)}
    </select>
  );
}
