"use client";

import { insertLayer, type Editor, type InsertKind } from "@vash/engine";
import { Image as ImageIcon, Shapes, Type, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tab = "text" | "shapes" | "photos";

const TABS: readonly { key: Tab; label: string; Icon: LucideIcon }[] = [
  { key: "text", label: "Text", Icon: Type },
  { key: "shapes", label: "Shapes", Icon: Shapes },
  { key: "photos", label: "Photos", Icon: ImageIcon },
];

const TILE = "flex flex-col items-center gap-2 rounded-xl bg-field p-3 text-[12px] text-muted hover:bg-line hover:text-text";

function Tile({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={TILE}>
      <svg aria-hidden viewBox="0 0 48 48" className="size-12 text-text">
        {children}
      </svg>
      {label}
    </button>
  );
}

function Panel({ tab, add }: { tab: Tab; add: (kind: InsertKind) => void }) {
  if (tab === "text") {
    return (
      <>
        <h2 className="text-[15px] font-semibold">Text</h2>
        {(
          [
            ["heading", "Add a heading", "font-[Poppins] text-[20px] font-bold"],
            ["subheading", "Add a subheading", "font-[Poppins] text-[16px] font-medium"],
            ["body", "Add a little text", "font-[Inter] text-[13px]"],
          ] as const
        ).map(([kind, label, style]) => (
          <button key={kind} type="button" onClick={() => add(kind)} className={cn("rounded-xl bg-field px-3.5 py-3 text-left hover:bg-line", style)}>
            {label}
          </button>
        ))}
      </>
    );
  }
  if (tab === "shapes") {
    return (
      <>
        <h2 className="text-[15px] font-semibold">Shapes</h2>
        <div className="grid grid-cols-2 gap-2">
          <Tile label="Rectangle" onClick={() => add("rect")}>
            <rect x="8" y="8" width="32" height="32" fill="currentColor" opacity=".35" />
          </Tile>
          <Tile label="Rounded" onClick={() => add("rounded")}>
            <rect x="8" y="8" width="32" height="32" rx="7" fill="currentColor" opacity=".35" />
          </Tile>
          <Tile label="Circle" onClick={() => add("ellipse")}>
            <circle cx="24" cy="24" r="16" fill="currentColor" opacity=".35" />
          </Tile>
          <Tile label="Triangle" onClick={() => add("triangle")}>
            <polygon points="24,8 40,38 8,38" fill="currentColor" opacity=".35" />
          </Tile>
        </div>
      </>
    );
  }
  return (
    <>
      <h2 className="text-[15px] font-semibold">Photos</h2>
      <p className="text-[12px] text-muted">A frame marks where a photo goes. Uploading your own photos is the next feature to arrive.</p>
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Square frame" onClick={() => add("frame")}>
          <rect x="8" y="8" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
        </Tile>
        <Tile label="Round frame" onClick={() => add("frame-circle")}>
          <circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
        </Tile>
      </div>
    </>
  );
}

/** The editor's left rail: pick Text, Shapes or Photos to open a panel of things to add to the design. */
export function InsertRail({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState<Tab | null>(null);

  return (
    <>
      <nav aria-label="Add to design" className="flex w-[68px] flex-none flex-col gap-0.5 border-r-[.5px] border-line p-1.5">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            aria-expanded={open === key}
            onClick={() => setOpen((o) => (o === key ? null : key))}
            className={cn(
              "flex h-[54px] flex-col items-center justify-center gap-1 rounded-xl text-muted hover:bg-field hover:text-text",
              open === key && "bg-field text-text",
            )}
          >
            <Icon aria-hidden className="size-5" strokeWidth={1.75} />
            <span className="text-[11px]">{label}</span>
          </button>
        ))}
      </nav>
      {open && (
        <div className="flex w-[240px] flex-none flex-col gap-3 overflow-y-auto border-r-[.5px] border-line p-4">
          <Panel tab={open} add={(kind) => editor && insertLayer(editor.core, kind)} />
        </div>
      )}
    </>
  );
}
