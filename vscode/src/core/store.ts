/**
 * show-me decks on disk: one JSON file per deck, one directory per workspace
 * folder. Same format and rules as lua/show_me/store.lua.
 *
 * The CLI has already checked layouts, panes and ranges. This module enforces
 * only what needs deck state, and keeps the newest KEEP decks. Every call is
 * synchronous, so requests handled on Node's one thread never interleave.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { View } from './protocol.gen.ts';

/** Views are opened by number, 1-9, so a deck holds at most 9. */
export const MAX_VIEWS = 9;

/** Decks kept per workspace; older ones are deleted on each create. */
export const KEEP = 10;

export type Deck = {
  id: number;
  title: string;
  /** Epoch milliseconds. */
  created_at: number;
  done: boolean;
  views: View[];
};

export type Log = (message: string) => void;

/** A request deck state rules out. Its message becomes the reply's error, verbatim. */
export class Rejection extends Error {
  override name = 'Rejection';
}

/** A store directory's name: the first 16 hex characters of sha256(folder). */
export function workspaceKey(folder: string): string {
  return createHash('sha256').update(folder).digest('hex').slice(0, 16);
}

export class Store {
  readonly root: string;
  readonly #log: Log;

  constructor(root: string, log: Log) {
    mkdirSync(root, { recursive: true });
    this.root = root;
    this.#log = log;
  }

  static forWorkspace(stateDir: string, folder: string, log: Log): Store {
    return new Store(join(stateDir, workspaceKey(folder)), log);
  }

  ids(): number[] {
    return readdirSync(this.root)
      .flatMap(name => /^(\d+)\.json$/.exec(name)?.[1] ?? [])
      .map(Number)
      .sort((a, b) => a - b);
  }

  /** The deck, or undefined when its file is missing or corrupt (corrupt is logged). */
  load(id: number): Deck | undefined {
    let text: string;
    try {
      text = readFileSync(this.#file(id), 'utf8');
    } catch {
      return undefined;
    }
    try {
      const deck: unknown = JSON.parse(text);
      if (Store.#isDeck(deck)) return deck;
    } catch {
      // Reported below, with a malformed shape.
    }
    this.#log(`skipping corrupt deck file ${this.#file(id)}`);
    return undefined;
  }

  get(id: number | undefined): Deck {
    const deck = id === undefined ? undefined : this.load(id);
    if (!deck) throw new Rejection(`unknown deck ${id}`);
    return deck;
  }

  create(title: string, now: number): Deck {
    const ids = this.ids();
    const deck: Deck = { id: (ids.at(-1) ?? 0) + 1, title, created_at: now, done: false, views: [] };
    this.#save(deck);
    for (const old of ids.slice(0, Math.max(0, ids.length + 1 - KEEP))) rmSync(this.#file(old), { force: true });
    return deck;
  }

  /** Returns the view's number within its deck. */
  addView(id: number | undefined, view: View): number {
    const deck = this.get(id);
    if (deck.done) throw new Rejection(`deck ${deck.id} is already done; start a new one`);
    if (deck.views.length >= MAX_VIEWS) {
      throw new Rejection(`deck ${deck.id} already has ${MAX_VIEWS} views, the most an editor can open by number`);
    }
    deck.views.push(view);
    this.#save(deck);
    return deck.views.length;
  }

  finish(id: number | undefined): Deck {
    const deck = this.get(id);
    if (deck.views.length === 0) throw new Rejection(`deck ${deck.id} has no views`);
    deck.done = true;
    this.#save(deck);
    return deck;
  }

  /** Done decks, newest first. */
  listDone(): Deck[] {
    return this.ids()
      .reverse()
      .map(id => this.load(id))
      .filter((deck): deck is Deck => deck?.done === true);
  }

  latestDone(): Deck | undefined {
    return this.listDone()[0];
  }

  #file(id: number): string {
    return join(this.root, `${id}.json`);
  }

  /** Written to a temp file and renamed, so a concurrent reader never sees half a deck. */
  #save(deck: Deck): void {
    const file = this.#file(deck.id);
    writeFileSync(`${file}.tmp`, JSON.stringify(deck));
    renameSync(`${file}.tmp`, file);
  }

  static #isDeck(value: unknown): value is Deck {
    const deck = value as Partial<Deck> | null;
    return typeof deck === 'object' && deck !== null && Number.isInteger(deck.id) && Array.isArray(deck.views);
  }
}
