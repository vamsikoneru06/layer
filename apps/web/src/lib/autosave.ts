/** "unsaved": waiting out the debounce. "offline": network failed, retrying. "conflict": the server has a newer version. */
export type SaveStatus = "saved" | "unsaved" | "saving" | "offline" | "error" | "conflict";

export interface Autosaver<D> {
  /** Record a new document; saves after `delayMs` of quiet. */
  change(doc: D): void;
  /** Save now (the manual "retry"). */
  flush(): Promise<void>;
  /** Adopt a server version after a reload, dropping any conflict and pending change. */
  reset(version: number): void;
  /** Changes not yet saved. */
  readonly dirty: boolean;
  readonly version: number;
  dispose(): void;
}

/**
 * Debounced autosave with optimistic concurrency: each save sends the version it was based on and
 * gets the next one back. `save` rejects with `{ status }` (0 = network, 409 = conflict).
 */
export function createAutosaver<D>(o: {
  version: number;
  delayMs: number;
  retryMs: number;
  save: (doc: D, version: number) => Promise<number>;
  onStatus: (status: SaveStatus) => void;
}): Autosaver<D> {
  let version = o.version;
  let latest: { doc: D } | null = null;
  let saving = false;
  let conflict = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let status: SaveStatus = "saved";

  const set = (s: SaveStatus) => {
    if (s === status) return;
    status = s;
    o.onStatus(s);
  };
  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  };

  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (conflict || saving || !latest) return;
    const { doc } = latest;
    latest = null;
    saving = true;
    set("saving");
    try {
      version = await o.save(doc, version);
      saving = false;
      if (latest) return void (await flush());
      set("saved");
    } catch (err) {
      saving = false;
      latest ??= { doc };
      const code = (err as { status?: number }).status;
      if (code === 409) {
        conflict = true;
        set("conflict");
      } else if (code === 0) {
        set("offline");
        schedule(o.retryMs);
      } else {
        set("error");
      }
    }
  }

  return {
    change(doc) {
      latest = { doc };
      if (conflict) return;
      if (!saving && status !== "offline") set("unsaved");
      schedule(o.delayMs);
    },
    flush,
    reset(next) {
      clearTimeout(timer);
      version = next;
      latest = null;
      conflict = false;
      set("saved");
    },
    get dirty() {
      return latest !== null || saving;
    },
    get version() {
      return version;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
