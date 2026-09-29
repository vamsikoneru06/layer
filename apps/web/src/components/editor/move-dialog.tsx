"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { listAllFolders, moveDesign, type Folder } from "@/lib/api";
import { SelectField } from "./fields";

const NONE = "";

export function MoveDialog({
  open,
  onClose,
  designId,
  folderId,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  designId: string;
  folderId: string | null;
  onMoved: (folderId: string | null, folderName: string | null) => void;
}) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [choice, setChoice] = useState(folderId ?? NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setChoice(folderId ?? NONE);
    setError(null);
    setFolders(null);
    listAllFolders().then(
      (all) => live && setFolders(all),
      (err: Error) => live && setError(err.message),
    );
    return () => {
      live = false;
    };
  }, [open, folderId]);

  async function move() {
    setBusy(true);
    setError(null);
    try {
      const target = choice === NONE ? null : choice;
      await moveDesign(designId, target);
      onMoved(target, folders?.find((f) => f.id === target)?.name ?? null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't move the design. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Move to folder">
      {folders && folders.length === 0 ? (
        <p className="text-sm text-muted">You have no folders yet. Create one on the Designs page.</p>
      ) : (
        <SelectField name="Folder" value={choice} disabled={folders === null || busy} onChange={setChoice}>
          <option value={NONE}>No folder</option>
          {folders?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </SelectField>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void move()} loading={busy} disabled={folders === null || (folders.length === 0 && folderId === null)}>
          Move
        </Button>
      </div>
    </Dialog>
  );
}
