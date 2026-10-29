"use client";

import { insertGrid, insertLayer, insertShape, type Editor, type GridOptions, type InsertKind, type ShapeSpec } from "@vash/engine";
import { Image as ImageIcon, Shapes, Type, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ICONS } from "@/lib/icon-paths";
import { filterByName } from "@/lib/element-helpers";
import { LINES, SHAPES, type CatalogShape } from "@/lib/shape-catalog";
import { cn } from "@/lib/utils";
import { GeometryPreview } from "./geometry-preview";
import { PhotosPanel } from "./photos-panel";

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

/** The Grids section: square cells, and a table with no gaps and a dark outline. */
const GRIDS: readonly { label: string; options: GridOptions }[] = [
  { label: "2 by 2", options: { rows: 2, cols: 2, cellSize: 120, gap: 12, fill: SHAPE_FILL, stroke: null } },
  { label: "3 by 3", options: { rows: 3, cols: 3, cellSize: 120, gap: 12, fill: SHAPE_FILL, stroke: null } },
  { label: "4 by 4", options: { rows: 4, cols: 4, cellSize: 120, gap: 12, fill: SHAPE_FILL, stroke: null } },
  { label: "Table", options: { rows: 3, cols: 4, cellSize: 100, gap: 0, fill: null, stroke: { color: INK, width: 4 } } },
];

/** The Tile's svg is 48 by 48; the grid fills 40 of it along its longer side, keeping its proportions. */
const PREVIEW = 48;
const PREVIEW_DRAWN = 40;

function GridPreview({ options: { rows, cols, cellSize, gap, fill } }: { options: GridOptions }) {
  const width = cols * cellSize + (cols - 1) * gap;
  const height = rows * cellSize + (rows - 1) * gap;
  const scale = PREVIEW_DRAWN / Math.max(width, height);
  const x0 = (PREVIEW - width * scale) / 2;
  const y0 = (PREVIEW - height * scale) / 2;
  const cell = cellSize * scale;
  const step = (cellSize + gap) * scale;
  const ink = fill === null ? { fill: "none", stroke: "currentColor", strokeWidth: 1.5 } : { fill: "currentColor", opacity: 0.35 };
  const cells = Array.from({ length: rows * cols }, (_, i) => ({ r: Math.floor(i / cols), c: i % cols }));
  return (
    <>
      {cells.map(({ r, c }) => (
        <rect key={`${r}-${c}`} x={x0 + c * step} y={y0 + r * step} width={cell} height={cell} {...ink} />
      ))}
    </>
  );
}

function GridTiles({ add }: { add: (options: GridOptions) => void }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-medium text-muted">Grids</h3>
      <div className="grid grid-cols-2 gap-2">
        {GRIDS.map(({ label, options }) => (
          <Tile key={label} label={label} onClick={() => add(options)}>
            <GridPreview options={options} />
          </Tile>
        ))}
      </div>
    </section>
  );
}

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

function Panel({
  tab,
  add,
  addShape,
  addGrid,
  editor,
}: {
  tab: Tab;
  add: (kind: InsertKind) => void;
  addShape: (spec: ShapeSpec) => void;
  addGrid: (options: GridOptions) => void;
  editor: Editor | null;
}) {
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
        <GridTiles add={addGrid} />
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
      <nav aria-label="Add to design" className="flex w-[68px] flex-none flex-col gap-0.5 border-r-[.5px] border-line p-1.5">
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
        <div className="flex w-[240px] flex-none flex-col gap-3 overflow-y-auto border-r-[.5px] border-line p-4">
          <Panel
            tab={open}
            editor={editor}
            add={(kind) => editor && insertLayer(editor.core, kind)}
            addShape={(spec) => editor && insertShape(editor.core, spec)}
            addGrid={(options) => editor && insertGrid(editor.core, options)}
          />
        </div>
      )}
    </>
  );
}
