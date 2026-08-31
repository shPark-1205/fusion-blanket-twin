import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[4px] text-xs font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent-cyan)] text-[#041216] hover:bg-[#6bdbe5]",
        outline: "border border-[var(--line-strong)] bg-[var(--surface-2)] text-[var(--text-primary)] hover:border-[var(--accent-cyan)] hover:bg-[var(--surface-3)]",
        ghost: "text-[var(--text-secondary)] hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]",
      },
      size: { default: "h-8 px-3", icon: "size-8 p-0", sm: "h-7 px-2.5 text-[11px]" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
