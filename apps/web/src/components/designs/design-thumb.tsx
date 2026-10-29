import { useRef } from "react";
import type { Doc } from "@vash/schema";
import { DocPreview } from "@/components/templates/doc-preview";
import { useAssetUrl } from "@/lib/asset-urls";
import { fitBox } from "@/lib/designs";
import { cn } from "@/lib/utils";

/**
 * The artboard at its real aspect ratio on the pasteboard, showing the design's preview image once
 * the editor has made one (the blank page until then). Designs kept on this device pass `doc` and are
 * drawn directly.
 */
export function DesignThumb({
  width,
  height,
  box,
  assetId,
  doc,
  className,
}: {
  width: number;
  height: number;
  box: { width: number; height: number };
  assetId?: string | null;
  doc?: Doc;
  className?: string;
}) {
  const size = fitBox(width, height, box.width, box.height);
  const { url: src, reload } = useAssetUrl(assetId);
  // Retry a failed image once per asset: a fresh URL fixes an expired one, and the guard stops a loop.
  const retried = useRef(new Set<string>());
  const onError = () => {
    if (!assetId || retried.current.has(assetId)) return;
    retried.current.add(assetId);
    reload();
  };
  return (
    <div className={cn("flex items-center justify-center rounded-[14px] bg-bg2", className)}>
      <div className="overflow-hidden rounded-[3px] bg-white shadow-[0_6px_16px_rgba(0,0,0,.16),0_0_0_.5px_rgba(0,0,0,.06)]" style={size}>
        {doc ? <DocPreview doc={doc} box={box} className="size-full shadow-none" /> : src && <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={onError} className="size-full object-cover" />}
      </div>
    </div>
  );
}
