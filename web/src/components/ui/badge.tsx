import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "cyan" | "green" | "amber" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-[3px] border px-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]",
        tone === "neutral" && "border-[var(--line-strong)] bg-[var(--surface-2)] text-[var(--text-secondary)]",
        tone === "cyan" && "border-cyan-400/25 bg-cyan-400/8 text-[var(--accent-cyan)]",
        tone === "green" && "border-emerald-400/25 bg-emerald-400/8 text-[var(--status-ok)]",
        tone === "amber" && "border-amber-400/25 bg-amber-400/8 text-[var(--accent-heat)]",
        tone === "muted" && "border-[var(--line)] bg-transparent text-[var(--text-muted)]",
        className,
      )}
      {...props}
    />
  );
}
