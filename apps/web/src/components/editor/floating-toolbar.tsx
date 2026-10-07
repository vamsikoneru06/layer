"use client";

import { checkPolicy, handlePositions, selectionFrame, topLevelSelection, type Command, type EditorCore, type EditorState } from "@vash/engine";
import type { NodeId } from "@vash/schema";
import { Blend, ClipboardPaste, Copy, Ellipsis, Layers, Lock, LockOpen, Paintbrush, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { placePopover, placeToolbar } from "@/lib/toolbar-position";
import { ContextMenu } from "./context-menu";
import { actionTitle, CONTEXT_LAYOUTS, toMenuItems, type Action, type ActionId } from "./editor-actions";
import { Slider } from "./fields";
import { IconButton } from "./icon-button";
import { ARRANGE_ROWS, changer } from "./properties-panel";

type Actions = Record<ActionId, Action>;
type View = { width: number; height: number };

/** The selected layers an opacity change is allowed on, and why not when there are none. */
function opacityTargets(state: Pick<EditorState, "doc" | "selection" | "mode">): { ids: NodeId[]; reason?: string } {
  const ids: NodeId[] = [];
  let reason: string | undefined;
  for (const id of topLevelSelection(state.doc, state.selection)) {
    const verdict = checkPolicy(state.doc, { type: "update", id, patch: { opacity: 1 } }, state.mode);
    if (verdict.ok) ids.push(id);
    else reason ??= verdict.reason;
  }
  return ids.length > 0 ? { ids } : { ids, reason: reason ?? "Select a layer first." };
}

/**
 * Quick tools that float just above the selection. Hidden while the pointer is dragging, marquee
 * selecting or a text layer is being typed into, and when nothing is selected.
 */
export function FloatingToolbar({
  core,
  state,
  actions,
  mac,
  container,
  focusCanvas,
}: {
  core: EditorCore;
  state: EditorState;
  actions: Actions;
  mac: boolean;
  container: RefObject<HTMLElement | null>;
  focusCanvas: () => void;
}) {
  const [view, setView] = useState<View | null>(null);

  // The canvas area changes size with the panels and the window; the toolbar stays inside it.
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => setView((v) => (v && v.width === el.clientWidth && v.height === el.clientHeight ? v : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [container]);

  const frame = state.dragging || state.marquee || state.editing || !view ? null : selectionFrame(state.doc, state.selection);
  if (!frame || !view) return null;
  return <ToolbarBody core={core} state={state} actions={actions} mac={mac} view={view} points={Object.values(handlePositions(frame, state.viewport))} focusCanvas={focusCanvas} />;
}

function ToolbarBody({
  core,
  state,
  actions,
  mac,
  view,
  points,
  focusCanvas,
}: {
  core: EditorCore;
  state: EditorState;
  actions: Actions;
  mac: boolean;
  view: View;
  points: { x: number; y: number }[];
  focusCanvas: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<View | null>(null);
  const [open, setOpen] = useState<"transparency" | "arrange" | null>(null);
  const [moreAt, setMoreAt] = useState<{ x: number; y: number } | null>(null);
  const triggers = { transparency: useRef<HTMLButtonElement>(null), arrange: useRef<HTMLButtonElement>(null) };
  const more = useRef<HTMLButtonElement>(null);
  const moreWasOpen = useRef(false);

  // Measured after each render: the toolbar's size is only known once it exists, and placement needs it.
  useLayoutEffect(() => {
    const el = root.current;
    if (el) setSize((s) => (s && s.width === el.offsetWidth && s.height === el.offsetHeight ? s : { width: el.offsetWidth, height: el.offsetHeight }));
  });
  const place = size ? placeToolbar(points, size, view) : { x: 0, y: 0 };

  const targets = opacityTargets(state);
  const button = (id: ActionId, icon: ReactNode, label = actions[id].label) => (
    <IconButton label={label} title={actionTitle(actions[id], mac)} onClick={actions[id].run} unavailable={actions[id].disabled}>
      {icon}
    </IconButton>
  );
  const lockLabel = actions.toggleLock.label;

  const close = (returnFocus: boolean) => {
    if (open && returnFocus) triggers[open].current?.focus();
    setOpen(null);
  };
  const toggle = (which: "transparency" | "arrange") => setOpen((current) => (current === which ? null : which));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      // Keep the editor from also clearing the selection.
      e.stopPropagation();
      e.preventDefault();
      if (open) close(true);
      else focusCanvas();
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // Arrow keys belong to the toolbar here, never to the canvas (they would nudge the layer).
    e.stopPropagation();
    const row = root.current;
    if (!row || !row.contains(e.target as Node)) return;
    const all = [...row.querySelectorAll<HTMLElement>("button")];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    all[(at + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length]?.focus();
  };

  const opacity = state.doc.nodes[targets.ids[0] ?? ""]?.opacity ?? 1;
  const setOpacity = (value: number, final: boolean) => {
    const commands = targets.ids.map((id): Command => ({ type: "update", id, patch: { opacity: value } }));
    changer(core)({ type: "batch", commands }, final);
  };

  return (
    <>
      <div
        ref={root}
        role="toolbar"
        aria-label="Layer tools"
        onKeyDown={onKeyDown}
        className="absolute z-20 flex items-center gap-0.5 rounded-xl bg-bg/90 p-1 shadow-[0_0_0_.5px_var(--line),0_8px_24px_rgba(0,0,0,.16)] backdrop-blur-xl"
        style={{ left: place.x, top: place.y, visibility: size ? undefined : "hidden" }}
      >
        {button("duplicate", <Copy aria-hidden />)}
        {button("copyStyle", <Paintbrush aria-hidden />)}
        {button("pasteStyle", <ClipboardPaste aria-hidden />)}
        <Divider />
        <IconButton
          ref={triggers.transparency}
          label="Transparency"
          title={targets.reason ?? "Transparency"}
          onClick={() => toggle("transparency")}
          unavailable={targets.reason}
          popup="dialog"
          expanded={open === "transparency"}
        >
          <Blend aria-hidden />
        </IconButton>
        {button("toggleLock", lockLabel === "Unlock" ? <LockOpen aria-hidden /> : <Lock aria-hidden />)}
        <IconButton ref={triggers.arrange} label="Arrange" title="Arrange" onClick={() => toggle("arrange")} popup="dialog" expanded={open === "arrange"}>
          <Layers aria-hidden />
        </IconButton>
        <Divider />
        {button("delete", <Trash2 aria-hidden />)}
        {/* The press already closes an open menu (outside click); remember that so the click does not open it again. */}
        <span
          className="flex"
          onPointerDownCapture={() => {
            moreWasOpen.current = moreAt !== null;
          }}
        >
          <IconButton
            ref={more}
            label="More"
            popup="menu"
            expanded={moreAt !== null}
            onClick={() => {
              if (moreWasOpen.current) return;
              const r = more.current!.getBoundingClientRect();
              setOpen(null);
              setMoreAt({ x: r.left, y: r.bottom + 6 });
            }}
          >
            <Ellipsis aria-hidden />
          </IconButton>
        </span>
        {open === "transparency" && (
          <Popover label="Transparency" anchor={triggers.transparency.current} onClose={() => close(false)}>
            <div className="w-[220px] p-2">
              <Slider label="Opacity" value={opacity} min={0} max={1} step={0.01} onChange={setOpacity} />
            </div>
          </Popover>
        )}
        {open === "arrange" && (
          <Popover label="Arrange" anchor={triggers.arrange.current} onClose={() => close(false)}>
            <div className="flex flex-col gap-1 p-1">
              {ARRANGE_ROWS.filter((row) => row.name === "Align" || row.name === "Order").map((row) => (
                <div key={row.name} role="group" aria-label={row.name} className="flex gap-1">
                  {row.buttons.map(({ id, icon }) => (
                    <IconButton key={id} label={actions[id].label} title={actionTitle(actions[id], mac)} onClick={actions[id].run} unavailable={actions[id].disabled}>
                      {icon}
                    </IconButton>
                  ))}
                </div>
              ))}
            </div>
          </Popover>
        )}
      </div>

      <ContextMenu
        at={moreAt}
        items={toMenuItems(actions, CONTEXT_LAYOUTS.node, mac)}
        onClose={() => {
          // Closed from the keyboard or by choosing an item: focus goes back to the button, not to the page.
          if (document.activeElement?.closest("[role=menu]")) more.current?.focus();
          setMoreAt(null);
        }}
      />
    </>
  );
}

const Divider = () => <div aria-hidden className="mx-0.5 h-5 w-px bg-line" />;

/** A small panel under (or above) its button. It sits in the page body so the canvas edge never clips it. An outside press or Tab away closes it. */
function Popover({ label, anchor, onClose, children }: { label: string; anchor: HTMLElement | null; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  // Placed again on every render, so it follows the toolbar when the canvas pans or zooms.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !anchor) return;
    const p = placePopover(anchor.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  });

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input, button")?.focus();
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !anchor?.contains(target)) latestClose.current();
    };
    const resize = () => latestClose.current();
    document.addEventListener("pointerdown", away);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("resize", resize);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      className="fixed z-50 rounded-2xl bg-bg p-1.5 shadow-[0_0_0_.5px_var(--line),0_12px_32px_rgba(0,0,0,.16)]"
      style={{ left: 0, top: 0 }}
      onBlur={(e) => {
        // Tab moved focus out of the panel (and not onto its own button).
        const next = e.relatedTarget as Node | null;
        if (next && !panel.current?.contains(next) && !anchor?.contains(next)) latestClose.current();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
