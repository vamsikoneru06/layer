"use client";

import type { Editor } from "@vash/engine";
import { Hand, MousePointer2 } from "lucide-react";
import { Segmented } from "./fields";

/** The pointer tool: `select` or `hand`. Derived from the engine's setter so the web does not repeat the union. */
export type PointerTool = Parameters<Editor["setTool"]>[0];

/** Select or Hand: what a drag on the canvas does. Holding Space pans in either mode. */
export function ToolSwitch({ tool, onChange }: { tool: PointerTool; onChange: (tool: PointerTool) => void }) {
  return (
    <Segmented<PointerTool>
      name="Tool"
      value={tool}
      options={[
        { value: "select", label: "Select", icon: <MousePointer2 aria-hidden /> },
        { value: "hand", label: "Hand", icon: <Hand aria-hidden /> },
      ]}
      onChange={onChange}
    />
  );
}
