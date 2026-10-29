"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatShortcut, OTHER_SHORTCUTS, SHORTCUT_ACTIONS, type Action, type ActionId } from "./editor-actions";

export function ShortcutsDialog({ open, onClose, actions, mac }: { open: boolean; onClose: () => void; actions: Record<ActionId, Action>; mac: boolean }) {
  const rows = [
    ...SHORTCUT_ACTIONS.flatMap((id) => (actions[id].shortcut ? [{ name: actions[id].label, keys: formatShortcut(actions[id].shortcut!, mac) }] : [])),
    ...OTHER_SHORTCUTS.map((o) => ({ name: o.does, keys: formatShortcut(o.spec, mac) })),
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <ul className="flex max-h-[50vh] flex-col overflow-y-auto text-sm">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-4 py-1.5">
            <span>{r.name}</span>
            <kbd className="rounded-md bg-field px-2 py-0.5 font-sans text-[12px] text-muted">{r.keys}</kbd>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
