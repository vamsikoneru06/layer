"use client";

import { ChevronDown, Copy, Ellipsis, Folder as FolderIcon, FolderInput, FolderOpen, LayoutGrid, Layers, List, PenLine, Plus, Search, SearchX, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { useSession } from "@/components/app/session";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Menu } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import * as api from "@/lib/api";
import type { DesignItem, Folder } from "@/lib/api";
import { parseDraggedIds, sortDesigns, type SortKey } from "@/lib/designs";
import { cn } from "@/lib/utils";
import { DesignCard, DesignRow, type CardActions } from "./design-card";

const DRAG_TYPE = "application/x-vash-designs";
const UNDO_MS = 5000;
const VIEW_KEY = "vash.designs.view";

type View = "grid" | "list";

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

/** Runs one API call per design and reports how many failed; the API has no batch endpoints. */
async function each<T>(items: T[], fn: (item: T) => Promise<unknown>): Promise<number> {
  const results = await Promise.allSettled(items.map(fn));
  return results.filter((r) => r.status === "rejected").length;
}

function FolderRow({
  icon,
  name,
  active,
  onOpen,
  onDropDesigns,
  menu,
}: {
  icon: ReactNode;
  name: string;
  active: boolean;
  onOpen: () => void;
  onDropDesigns: (ids: string[]) => void;
  menu?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const ids = parseDraggedIds(e.dataTransfer.getData(DRAG_TYPE));
        if (ids.length > 0) onDropDesigns(ids);
      }}
      className={cn(
        "group/folder flex h-9 flex-none items-center rounded-[10px] hover:bg-field",
        active && "bg-field font-semibold",
        over && "bg-field shadow-[inset_0_0_0_1.5px_var(--text)]",
      )}
    >
      <button type="button" onClick={onOpen} aria-current={active ? "true" : undefined} className="flex h-full min-w-0 flex-1 items-center gap-[9px] rounded-[10px] px-2.5 text-left">
        <span className="flex-none text-muted [&_svg]:size-4">{icon}</span>
        <span className="truncate">{name}</span>
      </button>
      {menu}
    </div>
  );
}

function MoveDialog({ open, folders, count, onClose, onMove }: { open: boolean; folders: Folder[]; count: number; onClose: () => void; onMove: (folderId: string | null) => void }) {
  const [target, setTarget] = useState<string>("none");
  const options = [{ id: "none", name: "No folder" }, ...folders];
  return (
    <Dialog open={open} onClose={onClose} title={count === 1 ? "Move design" : `Move ${count} designs`}>
      <div role="radiogroup" aria-label="Folder" className="flex max-h-[300px] flex-col gap-0.5 overflow-y-auto">
        {options.map((f) => (
          <label key={f.id} className={cn("flex h-10 cursor-pointer items-center gap-3 rounded-[10px] px-3 text-sm hover:bg-field", target === f.id && "bg-field font-medium")}>
            <input type="radio" name="folder" value={f.id} checked={target === f.id} onChange={() => setTarget(f.id)} className="accent-(--text)" />
            {f.name}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onMove(target === "none" ? null : target)}>Move</Button>
      </div>
    </Dialog>
  );
}

function BulkBar({ count, onMove, onDuplicate, onDelete, onClear }: { count: number; onMove: () => void; onDuplicate: () => void; onDelete: () => void; onClear: () => void }) {
  const chip = "flex h-[34px] items-center gap-1.5 rounded-[10px] bg-white/7 px-3.5 font-medium shadow-[inset_0_1px_0_rgba(255,255,255,.16),inset_0_0_0_.5px_rgba(255,255,255,.12)] transition hover:bg-white/14 active:scale-[.96]";
  return (
    <div
      role="toolbar"
      aria-label="Selected designs"
      className="glass-primary fixed bottom-20 left-1/2 z-30 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl py-1.5 pr-1.5 pl-[18px] text-sm text-white md:bottom-7 md:left-[calc(50%+120px)]"
    >
      <span className="mr-2.5 flex-none font-semibold">{count} selected</span>
      <button type="button" onClick={onMove} className={chip}>
        <FolderInput aria-hidden className="size-4" />
        <span className="hidden sm:inline">Move to folder</span>
      </button>
      <button type="button" onClick={onDuplicate} className={chip}>
        <Copy aria-hidden className="size-4" />
        <span className="hidden sm:inline">Duplicate</span>
      </button>
      <button type="button" onClick={onDelete} className={cn(chip, "text-[#FF8A80]")}>
        <Trash2 aria-hidden className="size-4" />
        <span className="hidden sm:inline">Delete</span>
      </button>
      <button type="button" onClick={onClear} aria-label="Clear selection" className="glass-btn glass-secondary mx-0.5 size-[34px] text-white opacity-70">
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function DesignsView() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const toast = useToast();
  const folderId = params.get("folder");

  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [designs, setDesigns] = useState<DesignItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [sort, setSort] = useState<SortKey>("edited");
  const [view, setView] = useState<View>("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);
  const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => setView(readView()), []);

  const signedIn = session.status === "user";

  useEffect(() => {
    if (!signedIn) return;
    api.listAllFolders().then(setFolders, (err: Error) => setError(err.message));
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    setDesigns(null);
    setSelected(new Set());
    api.listDesigns({ folderId }).then(
      (page) => {
        setDesigns(page.items);
        setCursor(page.nextCursor);
      },
      (err: Error) => setError(err.message),
    );
  }, [signedIn, folderId]);

  // Deletes wait out the undo window; leaving the page commits them.
  useEffect(() => {
    const pending = pendingDeletes.current;
    const flush = () => {
      for (const [id, timer] of pending) {
        clearTimeout(timer);
        void api.deleteDesign(id, true).catch(() => {});
      }
      pending.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (designs ?? []).filter((d) => !hidden.has(d.id) && (!needle || d.title.toLowerCase().includes(needle)));
    return sortDesigns(list, sort);
  }, [designs, hidden, q, sort]);

  const folderName = useCallback((id: string | null) => folders?.find((f) => f.id === id)?.name, [folders]);
  const currentFolder = folderId ? folders?.find((f) => f.id === folderId) : undefined;
  const byId = (ids: string[]) => (designs ?? []).filter((d) => ids.includes(d.id));

  const openFolder = (id: string | null) => router.push(id ? `/designs?folder=${id}` : "/designs");

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.listDesigns({ folderId, cursor });
      setDesigns((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      toast({ message: (err as Error).message });
    } finally {
      setLoadingMore(false);
    }
  };

  async function moveTo(ids: string[], target: string | null) {
    setMoving(null);
    const failed = await each(ids, (id) => api.moveDesign(id, target));
    setDesigns((prev) =>
      (prev ?? [])
        .map((d) => (ids.includes(d.id) ? { ...d, folderId: target } : d))
        // Leaving the open folder takes it off this list.
        .filter((d) => !folderId || d.folderId === folderId),
    );
    setSelected(new Set());
    const where = target ? `“${folderName(target) ?? "folder"}”` : "No folder";
    toast({ message: failed ? `${failed} couldn’t be moved. Try again.` : `Moved ${ids.length === 1 ? "1 design" : `${ids.length} designs`} to ${where}` });
  }

  async function duplicate(ids: string[]) {
    const copies: DesignItem[] = [];
    const failed = await each(ids, async (id) => copies.push(await api.duplicateDesign(id)));
    setDesigns((prev) => [...copies, ...(prev ?? [])]);
    setSelected(new Set());
    toast({ message: failed ? `${failed} couldn’t be duplicated. Try again.` : ids.length === 1 ? "Duplicated" : `Duplicated ${ids.length} designs` });
  }

  function remove(ids: string[]) {
    const titles = byId(ids).map((d) => d.title);
    setHidden((h) => new Set([...h, ...ids]));
    setSelected(new Set());
    for (const id of ids) {
      pendingDeletes.current.set(
        id,
        setTimeout(() => {
          pendingDeletes.current.delete(id);
          api.deleteDesign(id).then(
            () => setDesigns((prev) => (prev ?? []).filter((d) => d.id !== id)),
            () => {
              setHidden((h) => new Set([...h].filter((x) => x !== id)));
              toast({ message: "Couldn’t delete a design. It’s back in the list." });
            },
          );
        }, UNDO_MS),
      );
    }
    toast({
      icon: <Trash2 aria-hidden className="size-4 flex-none" />,
      message: ids.length === 1 ? `“${titles[0]}” deleted` : `${ids.length} designs deleted`,
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          for (const id of ids) {
            clearTimeout(pendingDeletes.current.get(id));
            pendingDeletes.current.delete(id);
          }
          setHidden((h) => new Set([...h].filter((x) => !ids.includes(x))));
          toast({ message: "Restored. Nothing was lost.", duration: 2500 });
        },
      },
    });
  }

  async function rename(d: DesignItem, title: string) {
    setDesigns((prev) => (prev ?? []).map((x) => (x.id === d.id ? { ...x, title } : x)));
    try {
      await api.renameDesign(d.id, title);
    } catch (err) {
      setDesigns((prev) => (prev ?? []).map((x) => (x.id === d.id ? { ...x, title: d.title } : x)));
      toast({ message: (err as Error).message });
    }
  }

  const actions: CardActions = {
    open: (d) => router.push(`/edit/${d.id}`),
    toggle: (d, e: MouseEvent) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const ids = visible.map((x) => x.id);
        if (e.shiftKey && anchor && ids.includes(anchor)) {
          const [from, to] = [ids.indexOf(anchor), ids.indexOf(d.id)];
          for (const id of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(id);
        } else if (next.has(d.id)) next.delete(d.id);
        else next.add(d.id);
        return next;
      });
      setAnchor(d.id);
    },
    rename,
    duplicate: (d) => duplicate([d.id]),
    move: (d) => setMoving([d.id]),
    remove: (d) => remove([d.id]),
    dragStart: (d, e: DragEvent) => {
      const ids = selected.has(d.id) ? [...selected] : [d.id];
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "move";
    },
  };

  async function submitFolder(name: string) {
    setNewFolder(null);
    if (!name.trim()) return;
    try {
      const f = await api.createFolder(name.trim());
      setFolders((prev) => [...(prev ?? []), f]);
    } catch (err) {
      toast({ message: (err as Error).message });
    }
  }

  async function submitFolderRename(f: Folder, name: string) {
    setRenamingFolder(null);
    if (!name.trim() || name.trim() === f.name) return;
    try {
      const next = await api.renameFolder(f.id, name.trim());
      setFolders((prev) => (prev ?? []).map((x) => (x.id === f.id ? next : x)));
    } catch (err) {
      toast({ message: (err as Error).message });
    }
  }

  async function confirmDeleteFolder(f: Folder) {
    setDeletingFolder(null);
    try {
      await api.deleteFolder(f.id);
      setFolders((prev) => (prev ?? []).filter((x) => x.id !== f.id));
      setDesigns((prev) => (prev ?? []).map((d) => (d.folderId === f.id ? { ...d, folderId: null } : d)));
      if (folderId === f.id) openFolder(null);
      toast({ message: `Folder “${f.name}” deleted. Its designs are still in All designs.` });
    } catch (err) {
      toast({ message: (err as Error).message });
    }
  }

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  };

  const header = (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <h1 className="text-[clamp(30px,5vw,40px)] leading-[1.02] font-bold tracking-[-0.035em]">Designs</h1>
      <div className="flex flex-wrap items-center gap-3">
        <label className="glass-secondary flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-4 text-sm text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-text sm:w-60 sm:flex-none">
          <Search aria-hidden className="size-4 flex-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search designs" placeholder="Search" className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted" />
        </label>
        <label className="relative flex items-center text-sm text-muted">
          <span className="sr-only">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-10 cursor-pointer appearance-none rounded-lg bg-transparent pr-6 pl-2 hover:text-text">
            <option value="edited">Last edited</option>
            <option value="name">Name</option>
            <option value="created">Created</option>
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-1 size-3.5" />
        </label>
        <div role="radiogroup" aria-label="View" className="flex rounded-[10px] bg-field p-[3px]">
          {(["grid", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              aria-label={v === "grid" ? "Grid view" : "List view"}
              onClick={() => changeView(v)}
              className={cn("flex h-[30px] items-center justify-center rounded-[7px] px-3.5 text-muted hover:text-text", view === v && "bg-(--seg) text-text shadow-(--segsh)")}
            >
              {v === "grid" ? <LayoutGrid aria-hidden className="size-4" /> : <List aria-hidden className="size-4" />}
            </button>
          ))}
        </div>
        {/* Phones already have "New" in the top bar. */}
        <ButtonLink href="/home#create" className="hidden md:inline-flex" icon={<Plus aria-hidden className="size-4" />}>
          New design
        </ButtonLink>
      </div>
    </div>
  );

  if (session.status === "guest") {
    return (
      <div className="flex flex-col gap-7">
        {header}
        <EmptyState
          icon={<Layers />}
          title="Sign in to see your designs"
          body="Designs saved to your account show up here on every device."
          action={
            <ButtonLink href="/signin" size="md">
              Sign in
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const selecting = selected.size > 0;
  const folderMenu = (f: Folder) => (
    <Menu
      className="mr-1 opacity-0 group-hover/folder:opacity-100 focus-within:opacity-100"
      items={[
        { label: "Rename", icon: <PenLine aria-hidden className="size-4 text-muted" />, onSelect: () => setRenamingFolder(f.id) },
        { label: "Delete folder", icon: <Trash2 aria-hidden className="size-4" />, danger: true, onSelect: () => setDeletingFolder(f) },
      ]}
      trigger={(props) => (
        <button type="button" {...props} aria-label={`More actions for ${f.name}`} className="flex size-7 items-center justify-center rounded-lg text-muted hover:text-text">
          <Ellipsis aria-hidden className="size-4" />
        </button>
      )}
    />
  );

  const folderInput = (initial: string, onDone: (v: string) => void) => (
    <input
      autoFocus
      defaultValue={initial}
      aria-label="Folder name"
      maxLength={80}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(e.currentTarget.value);
        if (e.key === "Escape") onDone(initial);
      }}
      className="h-9 w-full flex-none rounded-[10px] bg-field px-2.5 text-sm outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--text)] md:w-auto"
    />
  );

  let body: ReactNode;
  const failure = session.status === "error" ? session.message : error;
  if (failure) {
    body = <p className="text-sm text-danger">{failure}</p>;
  } else if (!designs) {
    body = (
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2.5">
            <div className="h-[200px] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-[14px] bg-bg2" />
            <div className="h-4 w-2/3 rounded bg-field" />
          </div>
        ))}
      </div>
    );
  } else if (visible.length === 0) {
    body = q.trim() ? (
      <EmptyState
        icon={<SearchX />}
        title={`Nothing matches “${q.trim()}”`}
        body={cursor ? "Load more designs to search older ones too." : "Check the spelling, or try another word."}
        action={
          <Button variant="secondary" onClick={() => setQ("")}>
            Clear search
          </Button>
        }
      />
    ) : currentFolder ? (
      <EmptyState icon={<FolderOpen />} title={`${currentFolder.name} is empty`} body="Drag designs onto the folder, or use Move to folder." />
    ) : (
      <EmptyState
        icon={<LayoutGrid />}
        title="No designs yet"
        body="Pick a size to start your first one."
        action={
          <ButtonLink href="/home#create" icon={<Plus aria-hidden className="size-4" />}>
            New design
          </ButtonLink>
        }
      />
    );
  } else {
    const shared = (d: DesignItem) => ({
      design: d,
      selected: selected.has(d.id),
      selecting,
      renaming: renaming === d.id,
      setRenaming: (on: boolean) => setRenaming(on ? d.id : null),
      folderName: folderName(d.folderId),
      actions,
    });
    body = (
      <div className="flex flex-col gap-6">
        {view === "grid" ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((d) => (
              <DesignCard key={d.id} {...shared(d)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col">
            {visible.map((d) => (
              <DesignRow key={d.id} {...shared(d)} />
            ))}
          </div>
        )}
        {cursor && (
          <Button variant="secondary" className="self-center" loading={loadingMore} onClick={loadMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-7">
      {header}
      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
        <nav aria-label="Folders" className="-mx-4 flex gap-1 overflow-x-auto px-4 text-sm [scrollbar-width:none] md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0">
          <FolderRow icon={<Layers />} name="All designs" active={!folderId} onOpen={() => openFolder(null)} onDropDesigns={(ids) => moveTo(ids, null)} />
          {(folders ?? []).map((f) =>
            renamingFolder === f.id ? (
              <div key={f.id}>{folderInput(f.name, (v) => submitFolderRename(f, v))}</div>
            ) : (
              <FolderRow
                key={f.id}
                icon={<FolderIcon />}
                name={f.name}
                active={folderId === f.id}
                onOpen={() => openFolder(f.id)}
                onDropDesigns={(ids) => moveTo(ids, f.id)}
                menu={folderMenu(f)}
              />
            ),
          )}
          {newFolder !== null ? (
            folderInput("", submitFolder)
          ) : (
            <button type="button" onClick={() => setNewFolder("")} className="flex h-9 flex-none items-center gap-[9px] rounded-[10px] px-2.5 text-muted hover:bg-field hover:text-text">
              <Plus aria-hidden className="size-4" />
              New folder
            </button>
          )}
        </nav>
        <div className="min-w-0">{body}</div>
      </div>

      {selecting && (
        <BulkBar
          count={selected.size}
          onMove={() => setMoving([...selected])}
          onDuplicate={() => duplicate([...selected])}
          onDelete={() => remove([...selected])}
          onClear={() => setSelected(new Set())}
        />
      )}

      <MoveDialog
        key={moving?.join() ?? "closed"}
        open={moving !== null}
        folders={folders ?? []}
        count={moving?.length ?? 0}
        onClose={() => setMoving(null)}
        onMove={(target) => moving && moveTo(moving, target)}
      />

      <Dialog open={deletingFolder !== null} onClose={() => setDeletingFolder(null)} title={`Delete “${deletingFolder?.name ?? ""}”?`}>
        <p className="text-sm text-muted">The folder goes away; the designs in it stay in All designs.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeletingFolder(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => deletingFolder && confirmDeleteFolder(deletingFolder)}>
            Delete folder
          </Button>
        </div>
      </Dialog>

    </div>
  );
}
