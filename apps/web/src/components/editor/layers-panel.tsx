"use client";

import { moveLayer, parentOf, renameLayer, toggleLockOfLayer, type EditorCore, type EditorState } from "@vash/engine";
import { LIMITS, type Node, type NodeId } from "@vash/schema";
import { ChevronDown, ChevronRight, Eye, EyeOff, Group, Image as ImageIcon, Lock, LockOpen, Shapes, Sticker, Type } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useToast } from "@/components/ui/toast";
import { dropIndex, layerName } from "@/lib/layer-order";
import { cn } from "@/lib/utils";

const ICONS: Record<Node["type"], typeof ImageIcon> = { frame: ImageIcon, text: Type, shape: Shapes, sticker: Sticker, group: Group };

/** Carried by a layer being dragged, so a drop elsewhere (a text field, the canvas) does not take it as text. */
const DRAG_TYPE = "application/x-vash-layer";

/** Where a dragged layer would land: the line is drawn on this side of this row. */
type Drop = { id: NodeId; edge: "above" | "below" };

/** The accessible mirror of the canvas: every layer, top first, selectable by keyboard. Drag a row, or press Alt+Up or Alt+Down on it, to reorder among its siblings. */
export function LayersPanel({ state, core }: { state: EditorState; core: EditorCore }) {
  const { doc, selection } = state;
  const list = useRef<HTMLUListElement>(null);
  const [editing, setEditing] = useState<NodeId | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<NodeId>>(new Set());
  const [dragging, setDragging] = useState<NodeId | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const toast = useToast();
  // A row that was moved or renamed is drawn again as a new element in the list, so focus is put back on it afterwards.
  const focusAfter = useRef<NodeId | null>(null);
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    list.current?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(id)}"]`)?.focus();
  });

  // Selecting a layer (on the canvas, say) that sits in a folded group opens that group. Folding one with a selected layer inside is still allowed.
  useEffect(() => {
    setCollapsed((current) => {
      let next: Set<NodeId> | null = null;
      for (const id of selection) {
        for (let p = parentOf(doc, id); p; p = parentOf(doc, p)) {
          if (!current.has(p)) continue;
          next ??= new Set(current);
          next.delete(p);
        }
      }
      return next ?? current;
    });
  }, [selection]); // only a new selection opens groups, not every edit

  const select = (id: NodeId, e: MouseEvent) => {
    if (e.shiftKey) core.select(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
    else core.select([id]);
  };

  // `index` counts the siblings bottom first, as the engine does; the panel shows the top layer as position 1.
  const move = (id: NodeId, index: number, total: number) => {
    focusAfter.current = id;
    if (!moveLayer(core, id, index)) {
      focusAfter.current = null;
      return;
    }
    toast({ message: `Moved to position ${total - index} of ${total}.`, duration: 3000 });
  };

  const onRowKeyDown = (e: KeyboardEvent, id: NodeId, siblings: readonly NodeId[]) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "F2") {
      e.preventDefault();
      e.stopPropagation();
      setEditing(id);
    } else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // Up on the screen is toward the front, which is later in the list. Stopped here so the canvas does not nudge the layer.
      e.preventDefault();
      e.stopPropagation();
      move(id, siblings.indexOf(id) + (e.key === "ArrowUp" ? 1 : -1), siblings.length);
    }
  };

  const onDragOver = (e: DragEvent<HTMLLIElement>, id: NodeId, siblings: readonly NodeId[]) => {
    if (!dragging) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const edge: Drop["edge"] = e.clientY < bounds.top + bounds.height / 2 ? "above" : "below";
    if (!siblings.includes(dragging)) return; // only among siblings: no preventDefault, so the pointer shows "not allowed"
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const next = dropIndex(siblings, dragging, id, edge) === null ? null : { id, edge };
    setDrop((current) => (current?.id === next?.id && current?.edge === next?.edge ? current : next));
  };

  const onDrop = (e: DragEvent<HTMLLIElement>, siblings: readonly NodeId[]) => {
    if (!dragging || !drop) return;
    e.preventDefault();
    const index = dropIndex(siblings, dragging, drop.id, drop.edge);
    if (index !== null) move(dragging, index, siblings.length);
    setDragging(null);
    setDrop(null);
  };

  const rows = (ids: readonly NodeId[], depth: number): React.ReactNode[] =>
    [...ids].reverse().flatMap((id) => {
      const n = doc.nodes[id];
      if (!n) return [];
      const Icon = ICONS[n.type];
      const selected = selection.includes(id);
      const name = layerName(n);
      const isGroup = n.type === "group";
      const folded = isGroup && collapsed.has(id);
      const row = (
        <li
          key={id}
          aria-level={depth + 1}
          draggable={editing !== id}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, id);
            e.dataTransfer.effectAllowed = "move";
            setDragging(id);
          }}
          onDragEnd={() => {
            setDragging(null);
            setDrop(null);
          }}
          onDragOver={(e) => onDragOver(e, id, ids)}
          onDrop={(e) => onDrop(e, ids)}
          className={cn("group relative flex h-9 items-center rounded-lg pr-1 hover:bg-field", selected && "bg-field", dragging === id && "opacity-50")}
          style={{ paddingLeft: 4 + depth * 16 }}
        >
          {drop?.id === id && <span aria-hidden className={cn("pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-text", drop.edge === "above" ? "-top-px" : "-bottom-px")} />}
          {isGroup ? (
            <button
              type="button"
              aria-label={`Layers in ${name}`}
              aria-expanded={!folded}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (!next.delete(id)) next.add(id);
                  return next;
                })
              }
              className="flex size-6 flex-none items-center justify-center rounded-md text-muted hover:text-text"
            >
              {folded ? <ChevronRight aria-hidden className="size-4" /> : <ChevronDown aria-hidden className="size-4" />}
            </button>
          ) : (
            <span aria-hidden className="size-6 flex-none" />
          )}
          <button
            type="button"
            data-layer={id}
            aria-pressed={selected}
            title="Double-click or press F2 to rename"
            aria-keyshortcuts="F2 Alt+ArrowUp Alt+ArrowDown"
            onClick={(e) => select(id, e)}
            onDoubleClick={() => setEditing(id)}
            onKeyDown={(e) => onRowKeyDown(e, id, ids)}
            className={cn("flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg pl-1 text-left text-[13px]", !n.visible && "text-muted", editing === id && "hidden")}
          >
            <Icon aria-hidden className="size-4 flex-none text-muted" strokeWidth={1.75} />
            <span className={cn("truncate", selected && "font-medium")}>
              {name}
              {!n.visible && <span className="sr-only"> (hidden)</span>}
            </span>
          </button>
          {editing === id && (
            <div className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-1">
              <Icon aria-hidden className="size-4 flex-none text-muted" strokeWidth={1.75} />
              <RenameInput
                // An unnamed layer starts from the name the panel shows for it.
                name={name}
                onDone={(value) => {
                  focusAfter.current = id;
                  // A refusal (locked layer, empty name) leaves a notice and keeps the field open.
                  const kept = renameLayer(core, id, value);
                  if (kept) setEditing(null);
                  else focusAfter.current = null;
                  return kept;
                }}
                onCancel={() => {
                  focusAfter.current = id;
                  setEditing(null);
                }}
                onBlurAway={(value) => {
                  // A refused name keeps the field open, as Enter does, so the typed text is not lost.
                  if (!renameLayer(core, id, value)) return false;
                  setEditing(null);
                  return true;
                }}
              />
            </div>
          )}
          <button
            type="button"
            aria-label={n.lock === "free" ? `Lock ${name}` : `Unlock ${name}`}
            title={n.lock === "free" ? "Lock layer" : n.lock === "locked" ? "Locked. Click to unlock." : "Layout locked by the template. Click to unlock."}
            onClick={() => void toggleLockOfLayer(core, id)}
            className={cn("flex size-7 items-center justify-center rounded-xl text-muted hover:text-text", n.lock === "free" && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
          >
            {n.lock === "free" ? <LockOpen aria-hidden className="size-3.5" /> : <Lock aria-hidden className={cn("size-3.5", n.lock === "content-only" && "opacity-60")} />}
          </button>
          <button
            type="button"
            aria-label={n.visible ? `Hide ${name}` : `Show ${name}`}
            onClick={() => core.dispatch({ type: "update", id, patch: { visible: !n.visible } })}
            className={cn("flex size-7 items-center justify-center rounded-xl text-muted hover:text-text", n.visible &&"opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
          >
            {n.visible ? <Eye aria-hidden className="size-4" /> : <EyeOff aria-hidden className="size-4" />}
          </button>
        </li>
      );
      return isGroup && !folded ? [row, ...rows(n.children, depth + 1)] : [row];
    });

  if (doc.root.length === 0) {
    return <p className="px-4 text-[13px] text-muted">No layers yet. Text, shapes and photos you add will show up here.</p>;
  }
  return (
    <ul
      ref={list}
      aria-label="Layers"
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDrop(null);
      }}
      className="flex flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-4"
    >
      {rows(doc.root, 0)}
    </ul>
  );
}

/**
 * The inline name field. Enter and clicking away save, Escape cancels; the schema's name limit applies.
 * `onDone` returns whether the name was kept, so a refused name leaves the field open on Enter.
 */
function RenameInput({
  name,
  onDone,
  onCancel,
  onBlurAway,
}: {
  name: string;
  onDone: (value: string) => boolean;
  onCancel: () => void;
  onBlurAway: (value: string) => boolean;
}) {
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  return (
    <input
      ref={input}
      value={draft}
      maxLength={LIMITS.nameChars}
      aria-label="Layer name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        // Enter and Escape already ended the edit; the field going away must not save a second time.
        if (finished.current) return;
        if (onBlurAway(draft)) finished.current = true;
        // Refused: the field stays open with the text (the notice says why), without pulling focus back.
      }}
      onKeyDown={(e) => {
        // While an input method is composing, Enter and Escape belong to it.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") {
          e.preventDefault();
          if (onDone(draft)) finished.current = true;
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finished.current = true;
          onCancel();
        }
      }}
      className="h-7 min-w-0 flex-1 rounded-md bg-bg px-1.5 text-[13px] outline-none shadow-[0_0_0_2px_var(--text)]"
    />
  );
}
