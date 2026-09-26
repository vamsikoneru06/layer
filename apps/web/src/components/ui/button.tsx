import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "danger";
type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-10 px-[18px] text-sm",
  lg: "h-[50px] px-6 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string): string {
  return cn("glass-btn", `glass-${variant}`, SIZES[size], className);
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3.5 flex-none rounded-full border-2 border-current border-r-transparent motion-safe:animate-[lyr-spin_.7s_linear_infinite]"
    />
  );
}

/** Glass-filled label; icons sit beside it in currentColor. */
function Label({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <>
      {icon}
      <span className="glass-label">{children}</span>
    </>
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  /** Shows a spinner and blocks clicks; `children` should already read as the busy label ("Sending…"). */
  loading?: boolean;
};

export function Button({ variant, size, icon, loading = false, className, children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      {...props}
      onClick={loading ? (e) => e.preventDefault() : props.onClick}
    >
      <Label icon={loading ? <Spinner /> : icon}>{children}</Label>
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size; icon?: ReactNode };

export function ButtonLink({ variant, size, icon, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      <Label icon={icon}>{children}</Label>
    </Link>
  );
}
