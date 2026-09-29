import { CloudAlert, CloudCheck, CloudOff, CloudUpload } from "lucide-react";
import type { ReactNode } from "react";
import type { SaveStatus } from "@/lib/autosave";
import { cn } from "@/lib/utils";

const STATUS: Record<SaveStatus, { icon: ReactNode; label: string }> = {
  saved: { icon: <CloudCheck aria-hidden />, label: "Saved" },
  unsaved: { icon: <CloudUpload aria-hidden />, label: "Unsaved changes" },
  saving: { icon: <CloudUpload aria-hidden />, label: "Saving…" },
  offline: { icon: <CloudOff aria-hidden />, label: "Offline, retrying" },
  retrying: { icon: <CloudAlert aria-hidden />, label: "Couldn’t save, retrying" },
  "signed-out": { icon: <CloudAlert aria-hidden />, label: "Signed out, changes not saved" },
  error: { icon: <CloudAlert aria-hidden />, label: "Couldn’t save" },
  conflict: { icon: <CloudAlert aria-hidden />, label: "Changed elsewhere" },
};

const LINK = "font-medium text-text underline-offset-4 hover:underline";

export function SaveIndicator({ status, onRetry, onResolve }: { status: SaveStatus; onRetry: () => void; onResolve: () => void }) {
  const s = STATUS[status];
  const alarming = status === "error" || status === "conflict" || status === "signed-out";
  return (
    <span role="status" className={cn("flex items-center gap-1.5 text-[13px] text-muted [&_svg]:size-4", alarming && "text-danger")}>
      {s.icon}
      {s.label}
      {status === "signed-out" && (
        // A new tab, so this editor and its unsaved changes stay open; saving resumes on return.
        <a href="/signin" target="_blank" rel="noopener" className={LINK}>
          Sign in
        </a>
      )}
      {(status === "error" || status === "signed-out" || status === "retrying") && (
        <button type="button" onClick={onRetry} className={LINK}>
          Retry
        </button>
      )}
      {status === "conflict" && (
        <button type="button" onClick={onResolve} className={LINK}>
          Resolve
        </button>
      )}
    </span>
  );
}
