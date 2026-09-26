"use client";

import { Check, Copy, Ellipsis, FolderInput, PenLine, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useEffect, useRef, type DragEvent, type MouseEvent } from "react";
import { Menu, type MenuItem } from "@/components/ui/menu";
import type { DesignItem } from "@/lib/api";
import { editedLabel, formatLabel } from "@/lib/designs";
import { cn } from "@/lib/utils";
import { DesignThumb } from "./design-thumb";

export type CardActions = {
  open: (d: DesignItem) => void;
  toggle: (d: DesignItem, e: MouseEvent) => void;
  rename: (d: DesignItem, title: string) => void;
  duplicate: (d: DesignItem) => void;
  move: (d: DesignItem) => void;
  remove: (d: DesignItem) => void;
  dragStart: (d: DesignItem, e: DragEvent) => void;
};

type Props = {
  design: DesignItem;
  selected: boolean;
  /** Any card selected: clicks toggle selection instead of opening. */
  selecting: boolean;
  renaming: boolean;
  setRenaming: (on: boolean) => void;
  folderName?: string;
  actions: CardActions;
};

function menuItems(d: DesignItem, a: CardActions, startRename: () => void): MenuItem[] {
  const icon = "size-4 text-muted";
  return [
    { label: "Open", icon: <SquareArrowOutUpRight aria-hidden className={icon} />, onSelect: () => a.open(d) },
    { label: "Rename", icon: <PenLine aria-hidden className={icon} />, onSelect: startRename },
    { label: "Duplicate", icon: <Copy aria-hidden className={icon} />, onSelect: () => a.duplicate(d) },
    { label: "Move to folder…", icon: <FolderInput aria-hidden className={icon} />, onSelect: () => a.move(d) },
    "separator",
    { label: "Delete", icon: <Trash2 aria-hidden className="size-4" />, onSelect: () => a.remove(d), danger: true },
  ];
}

function Checkbox({ checked, visible, onClick, label }: { checked: boolean; visible: boolean; onClick: (e: MouseEvent) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        "flex size-[22px] flex-none items-center justify-center rounded-[7px] transition-opacity focus-visible:opacity-100",
        checked ? "bg-text text-bg" : "bg-bg shadow-[inset_0_0_0_1.5px_var(--line)]",
        visible || checked ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
    >
      {checked && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
    </button>
  );
}

function TitleField({ value, onDone }: { value: string; onDone: (title: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const finish = () => {
    const next = ref.current?.value.trim() ?? "";
    onDone(next && next !== value ? next : null);
  };
  return (
    <input
      ref={ref}
      defaultValue={value}
      aria-label="Design name"
      maxLength={120}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish();
        if (e.key === "Escape") onDone(null);
      }}
      className="h-7 w-full min-w-0 rounded-md bg-field px-1.5 text-sm font-medium outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--text)]"
    />
  );
}

function MoreButton({ design, actions, onRename }: { design: DesignItem; actions: CardActions; onRename: () => void }) {
  return (
    <Menu
      items={menuItems(design, actions, onRename)}
      trigger={(props) => (
        <button type="button" {...props} aria-label={`More actions for ${design.title}`} className="flex size-7 flex-none items-center justify-center rounded-lg text-muted hover:bg-field hover:text-text">
          <Ellipsis aria-hidden className="size-[18px]" />
        </button>
      )}
    />
  );
}

export function DesignCard({ design: d, selected, selecting, renaming, setRenaming, actions }: Props) {
  const title = renaming ? (
    <TitleField
      value={d.title}
      onDone={(t) => {
        setRenaming(false);
        if (t) actions.rename(d, t);
      }}
    />
  ) : (
    <span className="truncate text-sm font-medium">{d.title}</span>
  );

  return (
    <div className="group flex min-w-0 flex-col gap-2.5">
      <div
        role="button"
        tabIndex={0}
        aria-label={selecting ? `${selected ? "Deselect" : "Select"} ${d.title}` : `Open ${d.title}`}
        draggable
        onDragStart={(e) => actions.dragStart(d, e)}
        onClick={(e) => (selecting || e.shiftKey || e.metaKey || e.ctrlKey ? actions.toggle(d, e) : actions.open(d))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (selecting) actions.toggle(d, e as unknown as MouseEvent);
            else actions.open(d);
          }
        }}
        className={cn(
          "relative cursor-pointer rounded-[14px] transition-[transform,box-shadow] duration-200 ease-(--ease)",
          "hover:-translate-y-[3px] hover:shadow-[0_14px_30px_rgba(0,0,0,.12),inset_0_0_0_.5px_var(--line)]",
        )}
      >
        <DesignThumb
          width={d.width}
          height={d.height}
          box={{ width: 190, height: 160 }}
          className={cn("h-[200px]", selected && "shadow-[inset_0_0_0_2px_var(--text)]")}
        />
        <div className="absolute top-2.5 left-2.5">
          <Checkbox checked={selected} visible={selecting} onClick={(e) => actions.toggle(d, e)} label={`Select ${d.title}`} />
        </div>
      </div>
      <div className="flex items-start justify-between gap-2 px-0.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title}
          <span className="truncate text-xs text-muted">
            {formatLabel(d.format)} · {editedLabel(d.updatedAt)}
          </span>
        </div>
        <MoreButton design={d} actions={actions} onRename={() => setRenaming(true)} />
      </div>
    </div>
  );
}

export function DesignRow({ design: d, selected, selecting, renaming, setRenaming, folderName, actions }: Props) {
  return (
    <div
      draggable
      onDragStart={(e) => actions.dragStart(d, e)}
      className={cn("group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-field", selected && "bg-field")}
    >
      <Checkbox checked={selected} visible={selecting} onClick={(e) => actions.toggle(d, e)} label={`Select ${d.title}`} />
      <button type="button" onClick={(e) => (selecting ? actions.toggle(d, e) : actions.open(d))} className="flex-none rounded-lg" aria-label={`Open ${d.title}`}>
        <DesignThumb width={d.width} height={d.height} box={{ width: 36, height: 36 }} className="size-12 rounded-lg" />
      </button>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <TitleField
            value={d.title}
            onDone={(t) => {
              setRenaming(false);
              if (t) actions.rename(d, t);
            }}
          />
        ) : (
          <span className="block truncate text-sm font-medium">{d.title}</span>
        )}
      </div>
      <span className="hidden w-24 text-[13px] text-muted sm:block">{formatLabel(d.format)}</span>
      <span className="hidden w-36 text-[13px] text-muted md:block">{editedLabel(d.updatedAt)}</span>
      <span className="hidden w-32 truncate text-[13px] text-muted lg:block">{folderName ?? "—"}</span>
      <MoreButton design={d} actions={actions} onRename={() => setRenaming(true)} />
    </div>
  );
}
