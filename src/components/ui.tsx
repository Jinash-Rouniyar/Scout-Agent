import * as React from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900",
        className,
      )}
      aria-hidden
    />
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[0.72rem] font-medium uppercase tracking-eyebrow text-slate-400">{children}</p>
  );
}

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">{children}</h1>
      {sub ? <p className="max-w-2xl text-sm leading-relaxed text-slate-600">{sub}</p> : null}
    </div>
  );
}

export function Card({
  className,
  children,
  shadow = "default",
}: {
  className?: string;
  children: React.ReactNode;
  shadow?: "default" | "lg" | "none";
}) {
  const shadowClass =
    shadow === "lg" ? "shadow-card-lg" : shadow === "none" ? "" : "shadow-card";
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-white p-6",
        shadowClass,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-[0.72rem] font-medium uppercase tracking-eyebrow text-slate-400">
      {children}
    </h3>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[0.72rem] font-medium uppercase tracking-eyebrow text-slate-400">
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200",
        props.className,
      )}
    />
  );
}

export function Button({
  children,
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary:
      "rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-black",
    ghost:
      "rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50",
    danger:
      "rounded-full bg-rose-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-rose-700",
  }[variant];
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
}) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700",
    good: "bg-emerald-50 text-emerald-700",
    warn: "bg-amber-50 text-amber-700",
    bad: "bg-rose-50 text-rose-700",
    accent: "bg-slate-900 text-white",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.7rem] font-medium",
        tones,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone = "neutral" }: { tone?: "good" | "warn" | "bad" | "neutral" }) {
  const colors = {
    good: "bg-emerald-500",
    warn: "bg-amber-400",
    bad: "bg-rose-400",
    neutral: "bg-slate-400",
  }[tone];
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", colors)} />;
}

export function ScoreDial({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 80 ? "text-emerald-600" : value >= 45 ? "text-amber-600" : "text-slate-500";
  return (
    <div className="min-w-[7rem] rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[0.65rem] font-medium uppercase tracking-eyebrow text-slate-400">
        {label}
      </div>
      <div className={cn("mt-1 text-3xl font-semibold tabular-nums tracking-tight", tone)}>
        {value}
      </div>
    </div>
  );
}

export function InsetPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600",
        className,
      )}
    >
      {children}
    </div>
  );
}
