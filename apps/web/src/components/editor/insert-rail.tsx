"use client";

import { insertLayer, insertShape, type Editor, type InsertKind, type ShapeSpec } from "@vash/engine";
import { Image as ImageIcon, Shapes, Type, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ICONS } from "@/lib/icon-paths";
import { filterByName } from "@/lib/element-helpers";
import { LINES, SHAPES, type CatalogShape } from "@/lib/shape-catalog";
import { cn } from "@/lib/utils";
import { PhotosPanel } from "./photos-panel";
import { GeometryPreview } from "./geometry-preview";

type Tab = "text" | "shapes" | "photos";

const TABS: readonly { key: Tab; label: string; Icon: LucideIcon }[] = [
  { key: "text", label: "Text", Icon: Type },
  { key: "shapes", label: "Shapes", Icon: Shapes },
  { key: "photos", label: "Photos", Icon: ImageIcon },
];

const TILE = "flex flex-col items-center gap-2 rounded-xl bg-field p-3 text-[12px] text-muted hover:bg-line hover:text-text";

/** Fill and outline colours for catalogue shapes, lines and icons (the Shapes panel's own palette). */
const SHAPE_FILL = "#C7C7CC";
const INK = "#1C1C1E";
/** Icons are inserted at 160 px with a 13 px stroke: lucide's 2 on a 24 grid, scaled. */
const ICON_SIZE = 160;
const ICON_STROKE = 13;

function Tile({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={TILE}>
      <svg aria-hidden viewBox="0 0 48 48" className="size-12 text-text">
        {children}
      </svg>
      {label}
    </button>
  );
}

function catalogSpec(entry: CatalogShape): ShapeSpec {
  return {
    name: entry.name,
    geometry: entry.geometry,
    width: entry.width,
    height: entry.height,
    fill: entry.fill ? { type: "solid", color: SHAPE_FILL } : null,
    stroke: entry.strokeWidth === null ? null : { color: INK, width: entry.strokeWidth },
  };
}

function CatalogTiles({ entries, add }: { entries: readonly CatalogShape[]; add: (spec: ShapeSpec) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {entries.map((entry) => (
        <Tile key={entry.id} label={entry.name} onClick={() => add(catalogSpec(entry))}>
          <GeometryPreview geometry={entry.geometry} width={entry.width} height={entry.height} filled={entry.fill} />
        </Tile>
      ))}
    </div>
  );
}

function IconsSection({ add }: { add: (spec: ShapeSpec) => void }) {
  const [query, setQuery] = useState("");
  const icons = filterByName(ICONS, query);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-medium text-muted">Icons</h3>
      <input
        type="search"
        aria-label="Search icons"
        placeholder="Search icons"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 min-w-0 rounded-lg bg-field px-2.5 text-[13px] text-text outline-none placeholder:text-muted focus:outline-2 focus:outline-offset-1 focus:outline-text"
      />
      {icons.length === 0 ? (
        <p className="text-[12px] text-muted">No icons match.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {icons.map((icon) => (
            <Tile
              key={icon.id}
              label={icon.name}
              onClick={() =>
                add({
                  name: icon.name,
                  geometry: { kind: "path", d: icon.d },
                  width: ICON_SIZE,
                  height: ICON_SIZE,
                  fill: null,
                  stroke: { color: INK, width: ICON_STROKE },
                })
              }
            >
              <GeometryPreview geometry={{ kind: "path", d: icon.d }} width={ICON_SIZE} height={ICON_SIZE} filled={false} />
            </Tile>
          ))}
        </div>
      )}
    </section>
  );
}

function Panel({ tab, add, addShape, editor }: { tab: Tab; add: (kind: InsertKind) => void; addShape: (spec: ShapeSpec) => void; editor: Editor | null }) {
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
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-muted">Shapes</h3>
          <CatalogTiles entries={SHAPES} add={addShape} />
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-muted">Lines and arrows</h3>
          <CatalogTiles entries={LINES} add={addShape} />
        </section>
        <IconsSection add={addShape} />
      </>
    );
  }
  return (
    <PhotosPanel
      editor={editor}
      frameTiles={
        <div className="grid grid-cols-2 gap-2">
          <Tile label="Square frame" onClick={() => add("frame")}>
            <rect x="8" y="8" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
          </Tile>
          <Tile label="Round frame" onClick={() => add("frame-circle")}>
            <circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
          </Tile>
        </div>
      }
    />
  );
}

/** The editor's left rail: pick Text, Shapes or Photos to open a panel of things to add to the design. */
export function InsertRail({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState<Tab | null>(null);

  return (
    <>
      <nav aria-label="Add to design" className="editor-island flex w-[68px] flex-none flex-col gap-0.5 p-1.5">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            aria-expanded={open === key}
            onClick={() => setOpen((o) => (o === key ? null : key))}
            className={cn(
              "group flex h-[54px] flex-col items-center justify-center gap-1 rounded-xl text-muted hover:bg-field hover:text-text",
              open === key && "bg-field text-text",
            )}
          >
            <Icon aria-hidden className="size-5 transition-[translate,scale] duration-300 ease-(--ease) group-hover:-translate-y-0.5 group-hover:scale-110 group-active:scale-90 motion-reduce:transition-none" strokeWidth={1.75} />
            <span className="text-[11px]">{label}</span>
          </button>
        ))}
      </nav>
      {open && (
        <div className="editor-island flex w-[240px] flex-none flex-col gap-3 overflow-y-auto p-4">
          <Panel
            tab={open}
            editor={editor}
            add={(kind) => editor && insertLayer(editor.core, kind)}
            addShape={(spec) => editor && insertShape(editor.core, spec)}
          />
        </div>
      )}
    </>
  );
}
