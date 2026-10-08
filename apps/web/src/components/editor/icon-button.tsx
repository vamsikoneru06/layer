import { useId, type ReactNode, type Ref } from "react";

/**
 * `title` is the tooltip when it should say more than the label (a shortcut, or why the button is off).
 * `disabled` switches the button off for good. `unavailable` is for a button that is off right now for a
 * reason worth reading: it looks disabled and does nothing, but stays focusable (`aria-disabled`) and the
 * reason is announced after its name, so keyboard and screen-reader users get it too. A button that opens
 * a popover passes `popup`, and `expanded` while it is open.
 */
export function IconButton({
  label,
  title = label,
  onClick,
  disabled,
  unavailable,
  popup,
  expanded,
  ref,
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  unavailable?: string;
  popup?: "dialog" | "menu";
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  const reasonId = useId();
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-haspopup={popup}
      aria-expanded={popup ? !!expanded : undefined}
      title={title}
      aria-disabled={unavailable ? true : undefined}
      aria-describedby={unavailable ? reasonId : undefined}
      onClick={unavailable ? undefined : onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-field disabled:opacity-35 disabled:hover:bg-transparent aria-disabled:opacity-35 aria-disabled:hover:bg-transparent [&_svg]:size-[18px]"
    >
      {children}
      {unavailable && (
        <span id={reasonId} className="sr-only">
          {unavailable}
        </span>
      )}
    </button>
  );
}
