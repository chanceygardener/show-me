/**
 * Lays show-me views over the current window (`showMe.openIn: currentWindow`).
 *
 * Before the first view it snapshots the layout and each group's active tab.
 * Each view applies its layout (never removing the user's own groups), opens
 * pane i as the active tab of group i, scrolls its range to the top and
 * highlights it. Tabs the user already had open are borrowed, never closed;
 * tabs show-me created are closed when no longer needed. Closing restores the
 * snapshot only while the window holds exactly the user's groups plus the
 * ones show-me's views added, and those added groups are empty. show-me never
 * applies a layout that would drop a group still holding a tab: dropping
 * merges its tabs into another group and pins them. Opening, stepping and
 * closing run one at a time, in the order they were asked for.
 *
 * Groups are tracked by a `GroupId`, which stays put for a group's lifetime,
 * because a group's view column shifts when the user splits a group or
 * `workbench.editor.closeEmptyGroups` removes one. A created tab the user
 * closes is forgotten, so a tab they reopen for the same file is theirs.
 */
import * as vscode from 'vscode';
import { caption } from './core/format.ts';
import { groupCount, layoutFor, shouldApplyLayout } from './core/layout.ts';
import type { EditorLayout, Snapshot } from './core/layout.ts';
import type { Pane } from './core/protocol.gen.ts';
import type { Deck } from './core/store.ts';
import { TabLedger } from './core/tabs.ts';
import type { TabKey } from './core/tabs.ts';
import { GroupIds } from './groups.ts';
import type { GroupId } from './groups.ts';

type Showing = {
  deck: Deck;
  view: number;
  keys: TabKey[];
  /** Highlighted range per `column|uri`. */
  ranges: Map<string, vscode.Range>;
};

/**
 * The snapshot plus the user's own groups, in column order, to find the ones closing removed;
 * and the groups show-me's views added and removed, to tell whether the user reshaped the window.
 */
type Before = { snapshot: Snapshot; groups: readonly (GroupId | undefined)[]; added: Set<GroupId>; removed: Set<GroupId> };

/** The groups show-me opened a created tab for `uri` in. */
type Tracked = { uri: string; groups: Set<GroupId> };

const VIEW_OPEN = 'showMe.viewOpen';
const id = (key: TabKey): string => `${key.column}|${key.uri}`;

export class Renderer implements vscode.Disposable {
  readonly #log: vscode.LogOutputChannel;
  readonly #ledger = new TabLedger();
  /**
   * Per created `column|uri`, every group show-me opened a tab for it in. Borrowed keys never
   * get an entry, so a user's tab can't be found through it.
   */
  readonly #tracked = new Map<string, Tracked>();
  readonly #ids: GroupIds;
  readonly #decoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('showMe.rangeBackground'),
    isWholeLine: true,
  });
  readonly #status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  readonly #subscriptions: vscode.Disposable[];
  #before: Before | undefined;
  #showing: Showing | undefined;
  /** The tail of the operations run so far; each new one starts when it settles. */
  #queue: Promise<void> = Promise.resolve();

  constructor(log: vscode.LogOutputChannel) {
    this.#log = log;
    this.#ids = new GroupIds(log);
    this.#subscriptions = [
      this.#ids,
      this.#decoration,
      this.#status,
      vscode.window.onDidChangeVisibleTextEditors(editors => this.#decorate(editors)),
      vscode.window.onDidChangeActiveTextEditor(editor => this.#caption(editor)),
      vscode.window.tabGroups.onDidChangeTabs(event => this.#forget(event.closed)),
    ];
  }

  get position(): { deck: Deck; view: number } | undefined {
    return this.#showing && { deck: this.#showing.deck, view: this.#showing.view };
  }

  open(deck: Deck, n: number): Promise<void> {
    return this.#serialize(() => this.#open(deck, n));
  }

  step(delta: number): Promise<void> {
    return this.#serialize(async () => {
      const showing = this.#showing;
      if (showing && showing.deck.views[showing.view - 1 + delta]) await this.#open(showing.deck, showing.view + delta);
    });
  }

  close(): Promise<void> {
    return this.#serialize(() => this.#close());
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
  }

  /** Run `op` once every earlier operation has settled. Callers see its result and report its errors. */
  #serialize(op: () => Promise<void>): Promise<void> {
    const run = this.#queue.then(op);
    this.#queue = run.catch((error: unknown) => this.#log.debug(`an operation failed; later ones still run: ${String(error)}`));
    return run;
  }

  async #open(deck: Deck, n: number): Promise<void> {
    const view = deck.views[n - 1];
    if (!view) return;
    const start = this.#ids.live();
    this.#before ??= await this.#takeSnapshot();
    const before = this.#before;
    const layout = shouldApplyLayout(before.snapshot.groups.length, view.panes.length) ? layoutFor(view.layout, view.panes.length) : undefined;
    // A layout with fewer groups waits until the tabs this view doesn't reuse are closed.
    const shrinks = view.panes.length < vscode.window.tabGroups.all.length;
    if (layout && !shrinks) await this.#applyLayout(layout);
    const keys = view.panes.map((pane, i) => ({ column: i + 1, uri: vscode.Uri.file(pane.path).toString() }));
    const ranges = new Map<string, vscode.Range>();
    for (const [i, pane] of view.panes.entries()) {
      const range = await this.#showPane(pane, keys[i]!);
      if (range) ranges.set(id(keys[i]!), range);
    }
    await this.#closeTabs(this.#ledger.release(keys));
    if (layout && shrinks) await this.#applyLayout(layout);
    this.#account(before, start);
    this.#showing = { deck, view: n, keys, ranges };
    await vscode.commands.executeCommand('setContext', VIEW_OPEN, true);
    this.#decorate(vscode.window.visibleTextEditors);
    this.#caption(vscode.window.activeTextEditor);
  }

  async #close(): Promise<void> {
    const showing = this.#showing;
    const before = this.#before;
    if (!showing || !before) return;
    const reshaped = !this.#holdsOnlyKnownGroups(before);
    this.#showing = undefined;
    this.#before = undefined;
    await this.#closeTabs(this.#ledger.release());
    this.#tracked.clear();
    this.#status.hide();
    this.#decorate(vscode.window.visibleTextEditors);
    await vscode.commands.executeCommand('setContext', VIEW_OPEN, false);
    if (reshaped) return this.#log.info('the window was reshaped during a view; leaving its layout as it is');
    const holding = [...before.added].flatMap(group => this.#ids.group(group)?.tabs ?? []);
    if (holding.length > 0) return this.#log.info(`a group show-me added still holds ${holding.length} tab(s); leaving the layout as it is`);
    await this.#restore(before);
  }

  /** Put the window back as the snapshot found it. */
  async #restore(before: Before): Promise<void> {
    if (!before.groups.some(group => group !== undefined && this.#ids.group(group))) {
      this.#log.warn("none of the window's groups from before the view are left; leaving its layout as it is");
      return;
    }
    await this.#reinsertGroups(before.groups);
    if (!(await this.#applyLayout(before.snapshot.layout))) return;
    await Renderer.#focusGroup(before.snapshot.activeColumn);
    await Renderer.#restoreActiveTabs(before.snapshot);
  }

  /** Record the groups that appeared or went away while show-me opened a view. */
  #account(before: Before, start: ReadonlySet<GroupId>): void {
    const live = this.#ids.live();
    for (const group of live) if (!start.has(group)) before.added.add(group);
    for (const group of start) if (!live.has(group)) before.removed.add(group);
  }

  /** Whether the window holds exactly the user's groups plus the ones show-me's views added. */
  #holdsOnlyKnownGroups(before: Before): boolean {
    const known = new Set([...before.groups, ...before.added].filter((group): group is GroupId => group !== undefined && !before.removed.has(group)));
    const live = this.#ids.live();
    return live.size === known.size && [...live].every(group => known.has(group));
  }

  /**
   * Apply `layout` unless it would drop a group that still holds a tab: setEditorLayout merges
   * a dropped group's tabs into the last group it keeps, and moving a tab pins it.
   */
  async #applyLayout(layout: EditorLayout): Promise<boolean> {
    const kept = groupCount(layout);
    const holding = vscode.window.tabGroups.all.filter(group => group.viewColumn > kept && group.tabs.length > 0);
    if (holding.length > 0) {
      this.#log.info(`not applying a ${kept}-group layout: it would move the tabs of column(s) ${holding.map(g => g.viewColumn).join(', ')}`);
      return false;
    }
    await vscode.commands.executeCommand('vscode.setEditorLayout', layout);
    return true;
  }

  /** Open `pane` in its group without replacing the user's preview tab; return its clamped range. */
  async #showPane(pane: Pane, key: TabKey): Promise<vscode.Range | undefined> {
    const existing = Renderer.#tabAt(key);
    this.#ledger.record(key, existing !== undefined);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(key.uri));
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: key.column,
      preview: existing?.isPreview ?? false,
      preserveFocus: key.column !== 1,
    });
    if (!existing && this.#ledger.isCreated(key)) this.#track(key);
    if (pane.first === undefined) return undefined;
    // The file may have shrunk since the agent made the deck.
    const last = document.lineCount - 1;
    const range = new vscode.Range(Math.min(pane.first - 1, last), 0, Math.min((pane.last ?? pane.first) - 1, last), 0);
    editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
    return range;
  }

  /** Remember the group show-me just opened a tab for created `key` in. */
  #track(key: TabKey): void {
    const group = vscode.window.tabGroups.all.find(g => g.viewColumn === key.column);
    if (!group) return this.#log.warn(`no group in column ${key.column} after showing ${key.uri}`);
    const groupId = this.#ids.of(group);
    if (groupId === undefined) return this.#log.warn(`column ${key.column} has an unknown group; not tracking ${key.uri}`);
    const tracked = this.#tracked.get(id(key)) ?? { uri: key.uri, groups: new Set() };
    tracked.groups.add(groupId);
    this.#tracked.set(id(key), tracked);
  }

  /**
   * Stop tracking show-me's tabs that were closed, by the user or by show-me. A tab whose group
   * is unknown is forgotten in every group: losing track only leaves a tab open.
   */
  #forget(closed: readonly vscode.Tab[]): void {
    for (const tab of closed) {
      if (!(tab.input instanceof vscode.TabInputText)) continue;
      const uri = tab.input.uri.toString();
      const groupId = this.#ids.of(tab.group);
      for (const tracked of this.#tracked.values()) {
        if (tracked.uri !== uri) continue;
        if (groupId === undefined) tracked.groups.clear();
        else tracked.groups.delete(groupId);
      }
    }
  }

  /** Close the tabs show-me opened for `keys` and forget them; `keys` must be ones the ledger released. */
  async #closeTabs(keys: TabKey[]): Promise<void> {
    const tabs = keys.flatMap(key => {
      const found = this.#trackedTabs(key);
      this.#tracked.delete(id(key));
      const users = found.filter(tab => tab.isDirty || tab.isPinned);
      if (users.length > 0) this.#log.info(`leaving ${key.uri} open: the user edited or pinned it`);
      return found.filter(tab => !users.includes(tab));
    });
    if (tabs.length > 0) await vscode.window.tabGroups.close(tabs, true);
  }

  /**
   * The tabs for `key` in the groups show-me opened it in, wherever those groups are now.
   * A group that's gone is skipped: falling back to `key.column` could find a user's tab.
   */
  #trackedTabs(key: TabKey): vscode.Tab[] {
    return [...(this.#tracked.get(id(key))?.groups ?? [])].flatMap(groupId => {
      const group = this.#ids.group(groupId);
      if (!group) this.#log.debug(`a group that showed ${key.uri} is gone; not closing anything for it`);
      const tab = group && Renderer.#tabIn(group, key.uri);
      return tab ? [tab] : [];
    });
  }

  /** Highlight the current view's ranges in visible editors; clear every other show-me highlight. */
  #decorate(editors: readonly vscode.TextEditor[]): void {
    for (const editor of editors) {
      const key = { column: editor.viewColumn ?? 0, uri: editor.document.uri.toString() };
      const range = this.#showing?.ranges.get(id(key));
      editor.setDecorations(this.#decoration, range ? [range] : []);
    }
  }

  /** Caption the pane whose editor is active, else pane 1. */
  #caption(editor: vscode.TextEditor | undefined): void {
    const showing = this.#showing;
    if (!showing) return this.#status.hide();
    const panes = showing.deck.views[showing.view - 1]!.panes;
    const active = editor && showing.keys.findIndex(k => k.column === editor.viewColumn && k.uri === editor.document.uri.toString());
    const pane = panes[active !== undefined && active >= 0 ? active : 0]!;
    this.#status.text = caption(showing.deck, showing.view, pane, vscode.workspace.asRelativePath(pane.path, false));
    this.#status.show();
  }

  static #tabAt(key: TabKey): vscode.Tab | undefined {
    const group = vscode.window.tabGroups.all.find(g => g.viewColumn === key.column);
    return group && Renderer.#tabIn(group, key.uri);
  }

  static #tabIn(group: vscode.TabGroup, uri: string): vscode.Tab | undefined {
    return group.tabs.find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri);
  }

  /** `tabGroups.all` lists groups in creation order; the snapshot lists them in column order. */
  async #takeSnapshot(): Promise<Before> {
    const layout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    const all = [...vscode.window.tabGroups.all].sort((a, b) => a.viewColumn - b.viewColumn);
    const groups = all.map(group => {
      const tab = group.activeTab;
      return tab?.input instanceof vscode.TabInputText ? { activeUri: tab.input.uri.toString(), activePreview: tab.isPreview } : { activePreview: false };
    });
    const snapshot = { layout, groups, activeColumn: vscode.window.tabGroups.activeTabGroup.viewColumn };
    return { snapshot, groups: all.map(group => this.#ids.of(group)), added: new Set(), removed: new Set() };
  }

  /**
   * `closeEmptyGroups` removes a group when show-me closes its last tab, shifting the user's
   * groups after it one column left. Put each removed group back in its place.
   */
  async #reinsertGroups(groups: readonly (GroupId | undefined)[]): Promise<void> {
    const live = this.#ids.live();
    const removed = groups.flatMap((group, i) => (group === undefined || live.has(group) ? [] : [i + 1]));
    for (const column of removed) {
      // Past the last group, setEditorLayout appends the rest.
      if (column > vscode.window.tabGroups.all.length) break;
      await Renderer.#focusGroup(column);
      await vscode.commands.executeCommand('workbench.action.newGroupLeft');
    }
  }

  /** Focus the group in `column`: the API has no direct way to activate an empty group. */
  static async #focusGroup(column: number): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    for (let i = 1; i < column; i++) await vscode.commands.executeCommand('workbench.action.focusNextGroup');
  }

  /** Re-activate each group's text tab from the snapshot; the active group goes last, taking focus. */
  static async #restoreActiveTabs(snapshot: Snapshot): Promise<void> {
    const order = snapshot.groups.map((group, i) => ({ ...group, column: i + 1 })).sort((a, b) => Number(a.column === snapshot.activeColumn) - Number(b.column === snapshot.activeColumn));
    for (const group of order) {
      if (!group.activeUri || !Renderer.#tabAt({ column: group.column, uri: group.activeUri })) continue;
      await vscode.window.showTextDocument(vscode.Uri.parse(group.activeUri), {
        viewColumn: group.column,
        preview: group.activePreview,
        preserveFocus: group.column !== snapshot.activeColumn,
      });
    }
  }
}
