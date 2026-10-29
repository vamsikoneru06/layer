import type { ReactNode } from "react";

export function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-field disabled:opacity-35 disabled:hover:bg-transparent [&_svg]:size-[18px]"
    >
      {children}
    </button>
  );
}
