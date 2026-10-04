import type { Doc } from "@vash/schema";
import { applyCommand, type Command } from "./commands";

export const HISTORY_LIMIT = 200;

interface Step {
  redo: Command;
  undo: Command;
}

/**
 * The document plus undo/redo. A transaction (begin → update… → commit) previews each update against
 * the document as it was at `begin`, so a whole drag becomes one undo step.
 */
export class History {
  #doc: Doc;
  #past: Step[] = [];
  #future: Step[] = [];
  #tx: { base: Doc; last: Command | null } | null = null;
  #listeners = new Set<() => void>();

  constructor(doc: Doc) {
    this.#doc = doc;
  }

  get doc(): Doc {
    return this.#doc;
  }

  /** The document as it was when the open transaction began. */
  get baseDoc(): Doc | null {
    return this.#tx?.base ?? null;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  get inTransaction(): boolean {
    return this.#tx !== null;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  execute(cmd: Command): void {
    this.commit();
    const { doc, inverse } = applyCommand(this.#doc, cmd);
    if (doc === this.#doc) return;
    this.#record({ redo: cmd, undo: inverse }, doc);
  }

  begin(): void {
    this.commit();
    this.#tx = { base: this.#doc, last: null };
  }

  update(cmd: Command): void {
    if (!this.#tx) return this.execute(cmd);
    this.#tx.last = cmd;
    this.#set(applyCommand(this.#tx.base, cmd).doc);
  }

  commit(): void {
    const tx = this.#tx;
    this.#tx = null;
    if (!tx?.last || this.#doc === tx.base) return;
    const { inverse } = applyCommand(tx.base, tx.last);
    this.#record({ redo: tx.last, undo: inverse }, this.#doc);
  }

  cancel(): void {
    const tx = this.#tx;
    this.#tx = null;
    if (tx) this.#set(tx.base);
  }

  undo(): void {
    this.commit();
    const step = this.#past.pop();
    if (!step) return;
    this.#future.push(step);
    this.#set(applyCommand(this.#doc, step.undo).doc);
  }

  redo(): void {
    this.commit();
    const step = this.#future.pop();
    if (!step) return;
    this.#past.push(step);
    this.#set(applyCommand(this.#doc, step.redo).doc);
  }

  /** Replace the document outright (e.g. a reload after a save conflict); clears history. */
  reset(doc: Doc): void {
    this.#tx = null;
    this.#past = [];
    this.#future = [];
    this.#set(doc);
  }

  #record(step: Step, doc: Doc): void {
    this.#past.push(step);
    if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
    this.#future = [];
    this.#set(doc);
  }

  #set(doc: Doc): void {
    this.#doc = doc;
    for (const listener of this.#listeners) listener();
  }
}
