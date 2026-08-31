"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

export function Slider({
  className,
  "aria-label": ariaLabel,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root className={cn("relative flex h-5 w-full touch-none select-none items-center", className)} {...props}>
      <SliderPrimitive.Track className="relative h-px grow overflow-hidden bg-[var(--line-strong)]">
        <SliderPrimitive.Range className="absolute h-full bg-[var(--accent-cyan)]" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb aria-label={ariaLabel} className="block size-3 rounded-[2px] border border-[var(--accent-cyan)] bg-[var(--surface-1)] shadow-[0_0_0_3px_rgba(53,196,210,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30" />
    </SliderPrimitive.Root>
  );
}
