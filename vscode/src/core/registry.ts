/**
 * This window's entry in the show-me registry, which is how the CLI finds it.
 * One JSON file per running editor under `<base>/editors/`, private to the
 * user; same rules as lua/show_me/registry.lua.
 */
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePrivateDir } from './paths.ts';
import type { Entry } from './protocol.gen.ts';

export type EntryFields = Omit<Entry, 'started_at' | 'focused_at'>;

export class Registry {
  readonly file: string;
  readonly #base: string;
  #entry: Entry;

  constructor(base: string, fields: EntryFields, now: number) {
    this.#base = base;
    this.file = join(base, 'editors', `${fields.editor}-${fields.pid}.json`);
    this.#entry = { ...fields, started_at: now, focused_at: now };
  }

  /** Write (or rewrite) the entry through a temp file, so the CLI never reads half of one. */
  write(): void {
    ensurePrivateDir(this.#base);
    ensurePrivateDir(join(this.#base, 'editors'));
    const tmp = `${this.file}.tmp`;
    rmSync(tmp, { force: true });
    writeFileSync(tmp, JSON.stringify(this.#entry), { mode: 0o600 });
    try {
      // On Windows the rename fails while a CLI has the old entry open.
      renameSync(tmp, this.file);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }

  /** The user is looking at this window, so it wins ties. */
  touch(now: number): void {
    this.#entry = { ...this.#entry, focused_at: now };
    this.write();
  }

  setFolders(folders: string[]): void {
    this.#entry = { ...this.#entry, workspace_folders: folders };
    this.write();
  }

  remove(): void {
    rmSync(this.file, { force: true });
  }
}
