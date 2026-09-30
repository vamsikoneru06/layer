"use client";

import { Menu } from "@/components/ui/menu";
import { MENUS, toMenuItems, type Action, type ActionId } from "./editor-actions";

const TITLES = { file: "File", edit: "Edit", view: "View", help: "Help" } as const;

export function MenuBar({ actions, mac }: { actions: Record<ActionId, Action>; mac: boolean }) {
  return (
    <nav aria-label="Editor menus" className="flex items-center">
      {(Object.keys(TITLES) as (keyof typeof TITLES)[]).map((key) => (
        <Menu
          key={key}
          align="start"
          items={toMenuItems(actions, MENUS[key], mac)}
          trigger={(props) => (
            <button type="button" {...props} className="h-8 rounded-lg px-2.5 text-[13px] font-medium hover:bg-field aria-expanded:bg-field">
              {TITLES[key]}
            </button>
          )}
        />
      ))}
    </nav>
  );
}
