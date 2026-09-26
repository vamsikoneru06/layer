import type { ReactNode } from "react";

/** Three offset cards with the icon on the glass top card, as in the handoff's empty states. */
function Illustration({ icon }: { icon: ReactNode }) {
  const card = "absolute left-[34px] top-[25px] h-[74px] w-[100px] rounded-2xl";
  return (
    <div aria-hidden className="relative h-[124px] w-[168px]">
      <div className={`${card} translate-x-[-16px] translate-y-[16px] -rotate-8 bg-field shadow-[inset_0_0_0_.5px_var(--line)]`} />
      <div className={`${card} translate-x-[-7px] translate-y-[7px] -rotate-3 bg-bg shadow-[inset_0_0_0_.5px_var(--line),0_8px_20px_rgba(0,0,0,.05)]`} />
      <div
        className={`${card} glass-primary flex translate-x-1.5 -translate-y-1.5 items-center justify-center text-white motion-safe:animate-[lyr-float_5.5s_ease-in-out_infinite] [&_svg]:size-[26px]`}
      >
        {icon}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[20px] bg-bg2 px-6 py-12 text-center">
      <Illustration icon={icon} />
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-balance">{title}</h2>
        <p className="text-sm text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}
