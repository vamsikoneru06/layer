"use client";

import type { Editor } from "@vash/engine";
import type { DragEvent } from "react";
import { PHOTO_DRAG_TYPE, parseDraggedPhoto, placePhotos, uploadAll } from "./photo-actions";

const accepts = (e: DragEvent) => e.dataTransfer.types.includes(PHOTO_DRAG_TYPE) || e.dataTransfer.types.includes("Files");

/**
 * Drop handlers for the canvas: a photo from the Photos panel, or image files from the computer
 * (uploaded first). The frame under the pointer is outlined and gets the first photo; the rest fill
 * empty frames in reading order. Progress and errors show as the editor's notice.
 */
export function usePhotoDrop(editor: Editor | null) {
  const notice = (text: string | null) => editor?.core.setChrome({ notice: text });
  return {
    onDragOver(e: DragEvent) {
      if (!editor || !accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      editor.dropTarget(e);
    },
    onDragLeave(e: DragEvent) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) editor?.dropTarget(null);
    },
    async onDrop(e: DragEvent) {
      if (!editor || !accepts(e)) return;
      e.preventDefault();
      const target = editor.dropTarget(e);
      editor.dropTarget(null);
      const dragged = e.dataTransfer.getData(PHOTO_DRAG_TYPE);
      if (dragged) {
        const photo = parseDraggedPhoto(dragged);
        if (photo) placePhotos(editor, [photo], target);
        return;
      }
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return notice("Drop JPEG, PNG or WebP photos.");
      const { photos, errors } = await uploadAll(files, (done, total) => done < total && notice(`Uploading ${done + 1} of ${total}…`));
      notice(errors.length ? errors.join(" ") : null);
      placePhotos(editor, photos, target);
    },
  };
}
