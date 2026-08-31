"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={6}
        className="z-50 rounded-[3px] border border-[var(--line-strong)] bg-[var(--surface-3)] px-2 py-1 text-[10px] text-[var(--text-primary)] shadow-xl"
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-[var(--surface-3)]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
