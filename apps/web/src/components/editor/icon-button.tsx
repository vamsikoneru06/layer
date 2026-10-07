import type { ReactNode } from "react";

/** `title` is the tooltip when it should say more than the label (a shortcut, or why the button is off). */
export function IconButton({ label, title = label, onClick, disabled, children }: { label: string; title?: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-field disabled:opacity-35 disabled:hover:bg-transparent [&_svg]:size-[18px]"
    >
      {children}
    </button>
  );
}
