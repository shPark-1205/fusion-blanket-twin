"use client";

import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

export const ToggleGroup = ToggleGroupPrimitive.Root;

export function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "h-7 flex-1 border-r border-[var(--line)] px-2 text-[10px] font-medium text-[var(--text-muted)] transition-colors last:border-r-0 hover:text-[var(--text-primary)] data-[state=on]:bg-cyan-400/10 data-[state=on]:text-[var(--accent-cyan)]",
        className,
      )}
      {...props}
    />
  );
}
