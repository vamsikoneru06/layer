"use client";

import type { EditorCore, EditorState } from "@vash/engine";
import type { Node, NodeId } from "@vash/schema";
import { Eye, EyeOff, Group, Image as ImageIcon, Lock, Shapes, Sticker, Type } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";

const ICONS: Record<Node["type"], typeof ImageIcon> = { frame: ImageIcon, text: Type, shape: Shapes, sticker: Sticker, group: Group };

/** The accessible mirror of the canvas: every layer, top first, selectable by keyboard. */
export function LayersPanel({ state, core }: { state: EditorState; core: EditorCore }) {
  const { doc, selection } = state;

  const select = (id: NodeId, e: MouseEvent) => {
    if (e.shiftKey) core.select(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
    else core.select([id]);
  };

  const rows = (ids: readonly NodeId[], depth: number): React.ReactNode[] =>
    [...ids].reverse().flatMap((id) => {
      const n = doc.nodes[id];
      if (!n) return [];
      const Icon = ICONS[n.type];
      const selected = selection.includes(id);
      const row = (
        <li key={id} className={cn("group flex h-9 items-center rounded-lg pr-1 hover:bg-field", selected && "bg-field")}>
          <button
            type="button"
            aria-pressed={selected}
            onClick={(e) => select(id, e)}
            className={cn("flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left text-[13px]", !n.visible && "text-muted")}
            style={{ paddingLeft: 10 + depth * 16 }}
          >
            <Icon aria-hidden className="size-4 flex-none text-muted" strokeWidth={1.75} />
            <span className={cn("truncate", selected && "font-medium")}>{n.name || n.type}</span>
          </button>
          {n.lock !== "free" && (
            <span title={n.lock === "locked" ? "Locked by the template" : "Layout locked — text and photo can change"} className="flex size-7 items-center justify-center text-muted">
              <Lock aria-label={n.lock === "locked" ? "Locked" : "Layout locked"} className={cn("size-3.5", n.lock === "content-only" && "opacity-60")} />
            </span>
          )}
          <button
            type="button"
            aria-label={n.visible ? `Hide ${n.name}` : `Show ${n.name}`}
            onClick={() => core.dispatch({ type: "update", id, patch: { visible: !n.visible } })}
            className={cn("flex size-7 items-center justify-center rounded-md text-muted hover:text-text", n.visible && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
          >
            {n.visible ? <Eye aria-hidden className="size-4" /> : <EyeOff aria-hidden className="size-4" />}
          </button>
        </li>
      );
      return n.type === "group" ? [row, ...rows(n.children, depth + 1)] : [row];
    });

  if (doc.root.length === 0) {
    return <p className="px-4 text-[13px] text-muted">No layers yet. Text, shapes and photos you add will show up here.</p>;
  }
  return <ul className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-4">{rows(doc.root, 0)}</ul>;
}
