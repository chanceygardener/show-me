/**
 * A stable id for each editor group, for as long as the group exists.
 *
 * From VS Code 1.126 (microsoft/vscode#321936) the extension host keeps one
 * `vscode.TabGroup` object per group. Before that, every full tab-model update
 * (opening a tab, adding, removing or moving a group) replaces every group's
 * object, so an object kept from earlier is no longer in `tabGroups.all`.
 * Replaced groups are matched by position: `tabGroups.all` lists groups in the
 * order they were created, which moving a group doesn't change.
 */
import * as vscode from 'vscode';

export type GroupId = number;

export class GroupIds implements vscode.Disposable {
  readonly #log: vscode.LogOutputChannel;
  /** Every live group's id, in `tabGroups.all` order. */
  #ids: Map<vscode.TabGroup, GroupId>;
  #next: GroupId = 0;
  readonly #subscription: vscode.Disposable;

  constructor(log: vscode.LogOutputChannel) {
    this.#log = log;
    this.#ids = new Map(vscode.window.tabGroups.all.map(group => [group, this.#fresh()]));
    this.#subscription = vscode.window.tabGroups.onDidChangeTabGroups(event => this.#remap(event));
  }

  /** The id of `group`, a member of `tabGroups.all` (or of a tab event's tabs). */
  of(group: vscode.TabGroup): GroupId | undefined {
    return this.#ids.get(group);
  }

  /** The live group with `id`, or undefined once it's gone. */
  group(id: GroupId): vscode.TabGroup | undefined {
    return vscode.window.tabGroups.all.find(group => this.#ids.get(group) === id);
  }

  live(): Set<GroupId> {
    return new Set(this.#ids.values());
  }

  dispose(): void {
    this.#subscription.dispose();
  }

  #remap(event: vscode.TabGroupChangeEvent): void {
    const now = vscode.window.tabGroups.all;
    const kept = now.filter(group => !event.opened.includes(group));
    const ids = kept.every(group => this.#ids.has(group)) ? kept.map(group => this.#ids.get(group)!) : this.#matchReplaced(kept, event.closed);
    this.#ids = new Map(now.map(group => [group, event.opened.includes(group) ? this.#fresh() : ids[kept.indexOf(group)]!]));
  }

  /**
   * Ids for `kept`, the surviving groups' replacement objects, taken from the surviving old
   * objects in the same order. If the counts disagree, the survivors get new ids: show-me then
   * loses track of its tabs and leaves them open rather than risk closing a user's.
   */
  #matchReplaced(kept: readonly vscode.TabGroup[], closed: readonly vscode.TabGroup[]): GroupId[] {
    const survivors = [...this.#ids.keys()].filter(group => !closed.includes(group));
    if (survivors.length === kept.length) return survivors.map(group => this.#ids.get(group)!);
    this.#log.warn(`could not match ${kept.length} replaced editor groups to ${survivors.length} known ones; forgetting them`);
    return kept.map(() => this.#fresh());
  }

  #fresh(): GroupId {
    return this.#next++;
  }
}
