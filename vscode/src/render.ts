/**
 * Lays show-me views over the current window (`showMe.openIn: currentWindow`).
 *
 * Before the first view it snapshots the layout and each group's active tab.
 * Each view applies its layout (never removing the user's own groups), opens
 * pane i as the active tab of group i, scrolls its range to the top and
 * highlights it. Tabs the user already had open are borrowed, never closed;
 * tabs show-me created are closed when no longer needed. Closing restores the
 * snapshot unless the user has reshaped the window since.
 *
 * Groups are tracked by their `vscode.TabGroup` object, which the extension
 * host keeps for a group's lifetime, because a group's view column shifts
 * when the user splits a group or `workbench.editor.closeEmptyGroups`
 * removes one.
 */
import * as vscode from 'vscode';
import { caption } from './core/format.ts';
import { layoutFor, shouldApplyLayout } from './core/layout.ts';
import type { EditorLayout, Snapshot } from './core/layout.ts';
import type { Pane } from './core/protocol.gen.ts';
import type { Deck } from './core/store.ts';
import { TabLedger } from './core/tabs.ts';
import type { TabKey } from './core/tabs.ts';

type Showing = {
  deck: Deck;
  view: number;
  keys: TabKey[];
  /** Highlighted range per `column|uri`. */
  ranges: Map<string, vscode.Range>;
  /** Group count right after this view opened, to tell whether the user reshaped the window. */
  groups: number;
};

/** The snapshot plus the user's own groups, in column order, to find the ones closing removed. */
type Before = { snapshot: Snapshot; groups: readonly vscode.TabGroup[] };

const VIEW_OPEN = 'showMe.viewOpen';
const id = (key: TabKey): string => `${key.column}|${key.uri}`;

export class Renderer implements vscode.Disposable {
  readonly #log: vscode.LogOutputChannel;
  readonly #ledger = new TabLedger();
  /** The group each recorded tab was shown in, per `column|uri`. */
  readonly #groups = new Map<string, vscode.TabGroup>();
  readonly #decoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('showMe.rangeBackground'),
    isWholeLine: true,
  });
  readonly #status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  readonly #subscriptions: vscode.Disposable[];
  #before: Before | undefined;
  #showing: Showing | undefined;

  constructor(log: vscode.LogOutputChannel) {
    this.#log = log;
    this.#subscriptions = [
      this.#decoration,
      this.#status,
      vscode.window.onDidChangeVisibleTextEditors(editors => this.#decorate(editors)),
      vscode.window.onDidChangeActiveTextEditor(editor => this.#caption(editor)),
    ];
  }

  get position(): { deck: Deck; view: number } | undefined {
    return this.#showing && { deck: this.#showing.deck, view: this.#showing.view };
  }

  async open(deck: Deck, n: number): Promise<void> {
    const view = deck.views[n - 1];
    if (!view) return;
    this.#before ??= await Renderer.#takeSnapshot();
    const layout = shouldApplyLayout(this.#before.snapshot.groups.length, view.panes.length) ? layoutFor(view.layout, view.panes.length) : undefined;
    // setEditorLayout merges the tabs of the groups it drops into the last group it keeps,
    // out of reach of #closeTabs, so a layout with fewer groups waits until those are closed.
    const shrinks = view.panes.length < vscode.window.tabGroups.all.length;
    if (layout && !shrinks) await vscode.commands.executeCommand('vscode.setEditorLayout', layout);
    const keys = view.panes.map((pane, i) => ({ column: i + 1, uri: vscode.Uri.file(pane.path).toString() }));
    const ranges = new Map<string, vscode.Range>();
    for (const [i, pane] of view.panes.entries()) {
      const range = await this.#showPane(pane, keys[i]!);
      if (range) ranges.set(id(keys[i]!), range);
    }
    await this.#closeTabs(this.#ledger.release(keys));
    if (layout && shrinks) await vscode.commands.executeCommand('vscode.setEditorLayout', layout);
    this.#showing = { deck, view: n, keys, ranges, groups: vscode.window.tabGroups.all.length };
    await vscode.commands.executeCommand('setContext', VIEW_OPEN, true);
    this.#decorate(vscode.window.visibleTextEditors);
    this.#caption(vscode.window.activeTextEditor);
  }

  async step(delta: number): Promise<void> {
    const showing = this.#showing;
    if (showing && showing.deck.views[showing.view - 1 + delta]) await this.open(showing.deck, showing.view + delta);
  }

  async close(): Promise<void> {
    const showing = this.#showing;
    const before = this.#before;
    if (!showing || !before) return;
    const reshaped = vscode.window.tabGroups.all.length !== showing.groups;
    this.#showing = undefined;
    this.#before = undefined;
    await this.#closeTabs(this.#ledger.release());
    this.#status.hide();
    this.#decorate(vscode.window.visibleTextEditors);
    await vscode.commands.executeCommand('setContext', VIEW_OPEN, false);
    if (reshaped) {
      this.#log.info('the window was reshaped during a view; leaving its layout as it is');
      return;
    }
    await Renderer.#reinsertGroups(before.groups);
    await vscode.commands.executeCommand('vscode.setEditorLayout', before.snapshot.layout);
    await Renderer.#focusGroup(before.snapshot.activeColumn);
    await Renderer.#restoreActiveTabs(before.snapshot);
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
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
    const group = vscode.window.tabGroups.all.find(g => g.viewColumn === key.column);
    if (group && !this.#groups.has(id(key))) this.#groups.set(id(key), group);
    if (pane.first === undefined) return undefined;
    // The file may have shrunk since the agent made the deck.
    const last = document.lineCount - 1;
    const range = new vscode.Range(Math.min(pane.first - 1, last), 0, Math.min((pane.last ?? pane.first) - 1, last), 0);
    editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
    return range;
  }

  async #closeTabs(keys: TabKey[]): Promise<void> {
    const tabs = keys.flatMap(key => {
      const tab = this.#trackedTab(key);
      this.#groups.delete(id(key));
      if (tab?.isDirty) this.#log.info(`leaving ${key.uri} open: it has unsaved changes`);
      return tab && !tab.isDirty ? [tab] : [];
    });
    if (tabs.length > 0) await vscode.window.tabGroups.close(tabs, true);
  }

  /**
   * The tab for `key` in the group it was shown in, wherever that group is now.
   * Undefined once the group is gone: falling back to `key.column` could find a user's tab.
   */
  #trackedTab(key: TabKey): vscode.Tab | undefined {
    const group = this.#groups.get(id(key));
    if (!group || !vscode.window.tabGroups.all.includes(group)) {
      this.#log.debug(`the group that showed ${key.uri} is gone; not closing anything for it`);
      return undefined;
    }
    return Renderer.#tabIn(group, key.uri);
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

  static async #takeSnapshot(): Promise<Before> {
    const layout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    const all = vscode.window.tabGroups.all;
    const groups = all.map(group => {
      const tab = group.activeTab;
      return tab?.input instanceof vscode.TabInputText ? { activeUri: tab.input.uri.toString(), activePreview: tab.isPreview } : { activePreview: false };
    });
    return { snapshot: { layout, groups, activeColumn: vscode.window.tabGroups.activeTabGroup.viewColumn }, groups: [...all] };
  }

  /**
   * `closeEmptyGroups` removes a group when show-me closes its last tab, shifting the user's
   * groups after it one column left. Put each removed group back in its place.
   */
  static async #reinsertGroups(groups: readonly vscode.TabGroup[]): Promise<void> {
    const removed = groups.flatMap((group, i) => (vscode.window.tabGroups.all.includes(group) ? [] : [i + 1]));
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
