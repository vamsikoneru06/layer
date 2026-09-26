import { fitBox } from "@/lib/designs";
import { cn } from "@/lib/utils";

/**
 * The artboard at its real aspect ratio on the pasteboard. Rendered thumbnails arrive with the editor
 * (designs.thumbnail_asset_id); until then the card shows the blank page.
 */
export function DesignThumb({
  width,
  height,
  box,
  className,
}: {
  width: number;
  height: number;
  box: { width: number; height: number };
  className?: string;
}) {
  const size = fitBox(width, height, box.width, box.height);
  return (
    <div className={cn("flex items-center justify-center rounded-[14px] bg-bg2", className)}>
      <div className="rounded-[3px] bg-white shadow-[0_6px_16px_rgba(0,0,0,.16),0_0_0_.5px_rgba(0,0,0,.06)]" style={size} />
    </div>
  );
}
