/**
 * Which tabs show-me opened (created) and which of the user's tabs it reused
 * (borrowed) while laying views over the current window. Only created tabs
 * are ever closed: closing a user's tab with unsaved changes opens a save dialog.
 */
export type TabKey = { column: number; uri: string };

const same = (a: TabKey, b: TabKey): boolean => a.column === b.column && a.uri === b.uri;
const among = (keys: readonly TabKey[], key: TabKey): boolean => keys.some(k => same(k, key));

export class TabLedger {
  #created: TabKey[] = [];
  #borrowed: TabKey[] = [];

  /** `existed`: the group already showed this file. A tab show-me created stays created. */
  record(key: TabKey, existed: boolean): void {
    if (among(this.#created, key) || among(this.#borrowed, key)) return;
    (existed ? this.#borrowed : this.#created).push(key);
  }

  /** Forget every tab not in `keep`; return the created ones among them, for the caller to close. */
  release(keep: readonly TabKey[] = []): TabKey[] {
    const close = this.#created.filter(key => !among(keep, key));
    this.#created = this.#created.filter(key => among(keep, key));
    this.#borrowed = this.#borrowed.filter(key => among(keep, key));
    return close;
  }

  isCreated(key: TabKey): boolean {
    return among(this.#created, key);
  }

  get borrowed(): readonly TabKey[] {
    return this.#borrowed;
  }
}
