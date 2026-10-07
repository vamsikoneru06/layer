import { LIMITS, type Doc, type NodeId } from "@vash/schema";
import type { Command } from "./commands";
import { History } from "./history";
import type { Box } from "./math";
import { checkPolicy, LOCKED, type EditMode } from "./policy";
import type { Guide } from "./snapping";
import type { Viewport } from "./viewport";

/** Everything the UI reads. A new object is published on every change (for useSyncExternalStore). */
export interface EditorState {
  doc: Doc;
  mode: EditMode;
  selection: readonly NodeId[];
  hover: NodeId | null;
  viewport: Viewport;
  guides: readonly Guide[];
  marquee: Box | null;
  dragging: boolean;
  /** Any selected layer is content-only (and we're not in Author Mode): no move/resize. */
  layoutLocked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Short message for the UI, e.g. why a change was refused. */
  notice: string | null;
  /** The text layer being typed into on the canvas, if any. */
  editing: NodeId | null;
}

type Chrome = Pick<EditorState, "hover" | "guides" | "marquee" | "dragging" | "viewport" | "notice" | "editing">;

/** The editor's state and its only write path: every document change passes the lock policy and the history. */
export class EditorCore {
  readonly history: History;
  readonly mode: EditMode;
  #selection: readonly NodeId[] = [];
  #chrome: Chrome = { hover: null, guides: [], marquee: null, dragging: false, viewport: { zoom: 1, panX: 0, panY: 0 }, notice: null, editing: null };
  #state: EditorState;
  #listeners = new Set<() => void>();
  #txRefused = false;

  constructor(doc: Doc, o: { mode?: EditMode } = {}) {
    this.mode = o.mode ?? "design";
    this.history = new History(doc);
    this.#state = this.#snapshot();
    this.history.subscribe(() => this.#publish());
  }

  getState = (): EditorState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get doc(): Doc {
    return this.history.doc;
  }

  /** Applies one command as one undo step. Returns false (and sets a notice) when a lock refuses it. */
  dispatch(cmd: Command): boolean {
    const verdict = checkPolicy(this.doc, cmd, this.mode);
    if (!verdict.ok) {
      this.setChrome({ notice: verdict.reason });
      return false;
    }
    this.history.execute(cmd);
    return true;
  }

  /** Starts a drag-style edit; previews replace each other and commit as one step. */
  beginTransaction(): void {
    this.#txRefused = false;
    this.history.begin();
  }

  preview(cmd: Command): boolean {
    if (this.#txRefused) return false;
    const base = this.history.baseDoc ?? this.doc;
    const verdict = checkPolicy(base, cmd, this.mode);
    if (!verdict.ok) {
      this.#txRefused = true;
      this.history.cancel();
      this.setChrome({ notice: verdict.reason });
      return false;
    }
    this.history.update(cmd);
    return true;
  }

  commitTransaction(): void {
    this.history.commit();
  }

  cancelTransaction(): void {
    this.history.cancel();
  }

  /**
   * Starts typing into a text layer. The whole edit is one transaction, so it becomes one undo step.
   * Content-only layers can be edited; locked ones can't (outside Author Mode).
   */
  startTextEdit(id: NodeId): boolean {
    const node = this.doc.nodes[id];
    if (node?.type !== "text" || this.#chrome.editing) return false;
    if (this.mode === "design" && node.lock === "locked") {
      this.setChrome({ notice: LOCKED });
      return false;
    }
    this.select([id]);
    this.beginTransaction();
    this.setChrome({ editing: id, hover: null, notice: null });
    return true;
  }

  /** Replaces the edited layer's text, cut to its `maxChars`. */
  editText(content: string): boolean {
    const id = this.#chrome.editing;
    const node = id ? (this.history.baseDoc ?? this.doc).nodes[id] : undefined;
    if (!id || node?.type !== "text") return false;
    return this.preview({ type: "update", id, patch: { content: content.slice(0, node.maxChars ?? LIMITS.textChars) } });
  }

  /** Ends typing: keeps the text as one undo step, or restores it (Escape). */
  endTextEdit(commit: boolean): void {
    if (!this.#chrome.editing) return;
    if (commit) this.commitTransaction();
    else this.cancelTransaction();
    this.setChrome({ editing: null });
  }

  undo(): void {
    this.history.undo();
  }

  redo(): void {
    this.history.redo();
  }

  select(ids: readonly NodeId[]): void {
    const next = [...new Set(ids)].filter((id) => this.doc.nodes[id]);
    if (next.length === this.#selection.length && next.every((id, i) => id === this.#selection[i])) return;
    this.#selection = next;
    this.#publish();
  }

  setChrome(patch: Partial<Chrome>): void {
    this.#chrome = { ...this.#chrome, ...patch };
    this.#publish();
  }

  #snapshot(): EditorState {
    const doc = this.history.doc;
    const selection = this.#selection.filter((id) => doc.nodes[id]);
    this.#selection = selection;
    const layoutLocked = this.mode === "design" && selection.some((id) => doc.nodes[id]?.lock !== "free");
    return { ...this.#chrome, doc, mode: this.mode, selection, layoutLocked, canUndo: this.history.canUndo, canRedo: this.history.canRedo };
  }

  #publish(): void {
    this.#state = this.#snapshot();
    for (const listener of this.#listeners) listener();
  }
}
