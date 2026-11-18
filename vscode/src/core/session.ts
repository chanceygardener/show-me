/**
 * What this window's show-me session knows: the folders it serves, the first
 * folder's deck store, and the deck the view keys act on. Mirrors
 * lua/show_me/state.lua; new decks go into the first folder's store.
 */
import { Rejection, Store } from './store.ts';
import type { Deck, Log } from './store.ts';

export class Session {
  readonly #stateDir: string;
  readonly #log: Log;
  #folders: string[] = [];
  #store: Store | undefined;
  #current: Deck | undefined;
  /** The store each unfinished deck was created in, so a folder change mid-deck doesn't move it. */
  readonly #unfinished = new Map<number, Store>();

  constructor(stateDir: string, log: Log) {
    this.#stateDir = stateDir;
    this.#log = log;
  }

  /** Serve `folders`. Forgets the old store and current deck, not unfinished decks. */
  setFolders(folders: string[]): void {
    this.#folders = folders;
    this.#store = undefined;
    this.#current = undefined;
  }

  get folders(): readonly string[] {
    return this.#folders;
  }

  store(): Store {
    const folder = this.#folders[0];
    if (folder === undefined) throw new Rejection('this VS Code window has no folder open');
    this.#store ??= Store.forWorkspace(this.#stateDir, folder, this.#log);
    return this.#store;
  }

  remember(id: number, store: Store): void {
    this.#unfinished.set(id, store);
  }

  forget(id: number): void {
    this.#unfinished.delete(id);
  }

  storeFor(id: number | undefined): Store {
    return (id !== undefined && this.#unfinished.get(id)) || this.store();
  }

  /** The last deck picked or finished, else the newest done deck on disk. */
  current(): Deck | undefined {
    if (this.#current === undefined && this.#folders.length > 0) this.#current = this.store().latestDone();
    return this.#current;
  }

  setCurrent(deck: Deck): void {
    this.#current = deck;
  }
}
