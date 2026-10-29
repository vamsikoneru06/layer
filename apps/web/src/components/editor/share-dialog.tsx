"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { createShareLink, listShareLinks, revokeShareLink, shareLinkLabel, type ShareLink } from "@/lib/share";

const messageOf = (err: unknown) => (err instanceof Error && err.message ? err.message : "Something went wrong. Try again.");

export function ShareDialog({ designId, open, onClose }: { designId: string; open: boolean; onClose: () => void }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const urlId = useId();

  useEffect(() => {
    if (!open) return;
    let live = true;
    setNow(new Date());
    setLinks(null);
    setCreated(null);
    setCopied(false);
    setConfirmId(null);
    setError(null);
    listShareLinks(designId).then(
      (items) => live && setLinks(items),
      (err: unknown) => live && setError(messageOf(err)),
    );
    return () => {
      live = false;
    };
  }, [open, designId]);

  async function refresh() {
    setLinks(await listShareLinks(designId));
  }

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const link = await createShareLink(designId);
      setCreated({ id: link.id, url: link.url });
      setCopied(false);
      await refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setCreating(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      // No clipboard access (for example on an insecure page): select the address so it can be copied by hand.
      urlRef.current?.select();
    }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    setError(null);
    try {
      await revokeShareLink(designId, id);
      if (created?.id === id) setCreated(null);
      setConfirmId(null);
      await refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Share design">
      <p className="text-sm text-muted">
        Anyone with a link can open a view-only copy of this design. They do not need to sign in. You can revoke a link at any time.
      </p>

      {created && (
        <div className="flex flex-col gap-2">
          <label htmlFor={urlId} className="text-sm font-medium">
            New link
          </label>
          <div className="flex gap-2">
            <input
              id={urlId}
              ref={urlRef}
              readOnly
              value={created.url}
              onFocus={(e) => e.currentTarget.select()}
              className="h-10 min-w-0 flex-1 rounded-xl bg-field px-3 text-[13px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-text"
            />
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="text-sm text-muted">Anyone with this link can view the design. They do not need an account.</p>
          <p className="text-xs text-muted">The address is only shown here. Copy it before you close this dialog.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Links</h3>
          <Button size="sm" onClick={() => void create()} loading={creating}>
            {creating ? "Creating…" : "Create link"}
          </Button>
        </div>

        {links === null && !error && <p className="text-sm text-muted">Loading links…</p>}
        {links?.length === 0 && <p className="text-sm text-muted">No links yet. Create one to share a view-only copy.</p>}
        {links && links.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {links.map((link) => (
              <li key={link.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">{shareLinkLabel(link.createdAt, now)}</span>
                  {confirmId !== link.id && (
                    <Button size="sm" variant="secondary" onClick={() => setConfirmId(link.id)} disabled={revokingId !== null}>
                      Revoke
                    </Button>
                  )}
                </div>
                {confirmId === link.id && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-danger">Revoke this link? Anyone who has it loses access.</p>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setConfirmId(null)} disabled={revokingId !== null}>
                        Keep link
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => void revoke(link.id)} loading={revokingId === link.id}>
                        Revoke link
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
