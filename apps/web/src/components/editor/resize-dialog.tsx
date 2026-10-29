"use client";

import { planResize, type ArtboardSize, type EditMode } from "@vash/engine";
import { FORMAT_KEYS, FORMATS, type Doc, type FormatKey } from "@vash/schema";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NumberField, Row, SelectField, Switch } from "./fields";

const CUSTOM = "custom" as const;

/** The format whose size is exactly this, or Custom. */
const formatFor = ({ width, height }: ArtboardSize): FormatKey =>
  FORMAT_KEYS.find((k) => k !== CUSTOM && FORMATS[k].width === width && FORMATS[k].height === height) ?? CUSTOM;

interface ResizeProps {
  onClose: () => void;
  doc: Doc;
  mode: EditMode;
  /** Resizes the design. Returns false when the engine refuses, and the dialog stays open. */
  onResize: (size: ArtboardSize, scaleContent: boolean) => boolean;
}

export function ResizeDialog({ open, ...props }: ResizeProps & { open: boolean }) {
  // The form is mounted only while open, so every opening starts from the design's current size.
  return open ? <ResizeForm {...props} /> : null;
}

function ResizeForm({ onClose, doc, mode, onResize }: ResizeProps) {
  const [size, setSize] = useState<ArtboardSize>({ width: doc.artboard.width, height: doc.artboard.height });
  const [format, setFormat] = useState<FormatKey>(() => formatFor(size));
  const [scaleContent, setScaleContent] = useState(true);

  const plan = planResize(doc, size, mode, scaleContent);
  const changed = size.width !== doc.artboard.width || size.height !== doc.artboard.height;
  // Nothing is said until the size has been changed: "That's already the size." would greet every opening.
  const reason = !plan.ok && changed ? plan.reason : null;

  const setDimensions = (next: ArtboardSize) => {
    setSize(next);
    setFormat(formatFor(next));
  };
  const pickFormat = (key: FormatKey) => {
    setFormat(key);
    if (key !== CUSTOM) setSize({ width: FORMATS[key].width, height: FORMATS[key].height });
  };
  const apply = () => {
    if (plan.ok && onResize(size, scaleContent)) onClose();
  };

  return (
    <Dialog open onClose={onClose} title="Resize design">
      <SelectField name="Format" value={format} onChange={(v) => pickFormat(v as FormatKey)}>
        {FORMAT_KEYS.map((k) => (
          <option key={k} value={k}>
            {k === CUSTOM ? "Custom size" : `${FORMATS[k].label} (${FORMATS[k].width} × ${FORMATS[k].height})`}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-2 gap-2.5">
        <NumberField label="W" name="Width" suffix="px" value={size.width} onCommit={(width) => setDimensions({ ...size, width })} />
        <NumberField label="H" name="Height" suffix="px" value={size.height} onCommit={(height) => setDimensions({ ...size, height })} />
      </div>
      <div className="flex flex-col gap-2">
        <Row label="Scale content to fit">
          <Switch checked={scaleContent} onChange={setScaleContent} label="Scale content to fit" />
        </Row>
        <p className="text-sm text-muted">Layers scale with the design and stay centred. Off keeps each layer at its size and place.</p>
      </div>
      {reason && (
        <p role="alert" className="text-sm text-danger">
          {reason}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={apply} disabled={!plan.ok}>
          Resize
        </Button>
      </div>
    </Dialog>
  );
}
