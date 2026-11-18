import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { GroupIds } from '../../src/groups.ts';
import { Renderer } from '../../src/render.ts';
import type { EditorLayout } from '../../src/core/layout.ts';
import type { Deck } from '../../src/core/store.ts';

const root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
const file = (name: string) => join(root, name);
const uriOf = (name: string) => vscode.Uri.file(file(name)).toString();

const deck: Deck = {
  id: 1, title: 'Tour', created_at: 0, done: true,
  views: [
    { layout: 'single', panes: [{ path: file('a.txt'), first: 3, last: 5 }] },
    { layout: 'cols2', title: 'Both', panes: [{ path: file('c.txt') }, { path: file('d.txt'), first: 2, last: 2 }] },
    { layout: 'cols3', panes: [{ path: file('a.txt') }, { path: file('b.txt') }, { path: file('c.txt') }] },
  ],
};

function tabsIn(column: number) {
  const group = vscode.window.tabGroups.all.find(g => g.viewColumn === column);
  return (group?.tabs ?? []).map(t => ({
    uri: t.input instanceof vscode.TabInputText ? t.input.uri.toString() : '',
    dirty: t.isDirty, preview: t.isPreview, active: t.isActive,
  }));
}

/** Revert dirty files first: closing a dirty editor opens a save dialog, which would hang the run. */
async function reset(): Promise<void> {
  for (const document of vscode.workspace.textDocuments.filter(d => d.isDirty)) {
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{}] });
}

async function openUser(name: string, column: number, preview = false): Promise<vscode.TextEditor> {
  return vscode.window.showTextDocument(vscode.Uri.file(file(name)), { viewColumn: column, preview });
}

suite('currentWindow rendering', () => {
  let renderer: Renderer;
  setup(async () => {
    await reset();
    renderer = new Renderer(vscode.window.createOutputChannel('show-me test', { log: true }));
  });
  teardown(async () => {
    renderer.dispose();
    await reset();
  });

  test('never closes or pins a user tab, even a dirty one', async () => {
    const dirty = await openUser('user.txt', 1);
    await dirty.edit(edit => edit.insert(new vscode.Position(0, 0), 'unsaved '));
    await openUser('other.txt', 1, true);

    await renderer.open(deck, 1);
    await renderer.step(1);
    await renderer.close();

    const tabs = tabsIn(1);
    assert.deepEqual(tabs.map(t => t.uri).sort(), [uriOf('other.txt'), uriOf('user.txt')].sort());
    assert.equal(tabs.find(t => t.uri === uriOf('user.txt'))?.dirty, true);
    assert.equal(tabs.find(t => t.uri === uriOf('other.txt'))?.preview, true);
    assert.equal(tabs.find(t => t.uri === uriOf('other.txt'))?.active, true);
    assert.equal(vscode.window.tabGroups.all.length, 1);
  });

  test('reuses a tab the user had open and leaves it open', async () => {
    await openUser('a.txt', 1);
    await renderer.open(deck, 1);
    assert.equal(tabsIn(1).filter(t => t.uri === uriOf('a.txt')).length, 1);
    await renderer.close();
    assert.deepEqual(tabsIn(1).map(t => t.uri), [uriOf('a.txt')]);
  });

  test('scrolls the range to the top', async () => {
    await renderer.open(deck, 1);
    const editor = vscode.window.activeTextEditor!;
    assert.equal(editor.document.uri.toString(), uriOf('a.txt'));
    assert.equal(editor.visibleRanges[0]?.start.line, 2);
  });

  test('switching views closes only the tabs the next view does not reuse', async () => {
    await renderer.open(deck, 3);
    await renderer.step(-1);
    const open = vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => (t.input as vscode.TabInputText).uri.toString());
    assert.deepEqual(open.sort(), [uriOf('c.txt'), uriOf('d.txt')].sort());
    assert.equal(vscode.window.tabGroups.all.length, 2);
  });

  test('never shrinks: the user\'s extra groups survive a smaller view', async () => {
    await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{}, {}, {}] });
    await openUser('user.txt', 3);
    await renderer.open(deck, 1);
    assert.equal(vscode.window.tabGroups.all.length, 3);
    await renderer.close();
    assert.equal(vscode.window.tabGroups.all.length, 3);
    assert.deepEqual(tabsIn(3).map(t => t.uri), [uriOf('user.txt')]);
  });

  test('leaves a reshaped layout alone', async () => {
    await renderer.open(deck, 2);
    await vscode.commands.executeCommand('workbench.action.splitEditorRight');
    const groups = vscode.window.tabGroups.all.length;
    await renderer.close();
    const left = vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => (t.input as vscode.TabInputText).uri.toString());
    assert.ok(groups >= 3);
    assert.ok(left.length >= 1, 'the tab the user split off stays open');
    assert.equal(left.filter(u => u === uriOf('d.txt')).length, 0, "show-me's own tabs are closed");
  });

  test('a tab borrowed in an earlier session is not closed after the user moves its group', async () => {
    // Before VS Code 1.126 a TabGroup object goes stale on the next tab-model update; look the group up by id.
    const ids = new GroupIds(vscode.window.createOutputChannel('show-me test ids', { log: true }));
    await openUser('a.txt', 1);
    const userGroupId = ids.of(vscode.window.tabGroups.all[0]!)!;
    const userGroup = () => ids.group(userGroupId);
    await renderer.open(deck, 1);
    await renderer.close();
    await vscode.commands.executeCommand('workbench.action.newGroupLeft');
    assert.equal(userGroup()?.viewColumn, 2);

    await renderer.open(deck, 1);
    await renderer.close();

    assert.ok(userGroup(), "the user's group survives");
    assert.deepEqual(userGroup()!.tabs.map(t => (t.input as vscode.TabInputText).uri.toString()), [uriOf('a.txt')]);
    const copies = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => (t.input as vscode.TabInputText).uri.toString() === uriOf('a.txt'));
    assert.equal(copies.length, 1, "show-me's copy is closed");
    ids.dispose();
  });

  test('a created tab reopened in a group the user inserted is closed too', async () => {
    const twice: Deck = { ...deck, views: [deck.views[1]!, { layout: 'cols2', panes: [{ path: file('a.txt') }, { path: file('d.txt') }] }] };
    await renderer.open(twice, 1);
    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await vscode.commands.executeCommand('workbench.action.newGroupLeft');
    await renderer.step(1);
    await renderer.close();
    const open = vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => (t.input as vscode.TabInputText).uri.toString());
    assert.deepEqual(open, []);
  });

  test('a middle group emptied by show-me is put back in its place', async () => {
    await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{}, {}, {}] });
    await openUser('user.txt', 1);
    await openUser('other.txt', 3);
    await renderer.open({ ...deck, views: [{ layout: 'cols2', panes: [{ path: file('user.txt') }, { path: file('a.txt') }] }] }, 1);
    await renderer.close();
    assert.equal(vscode.window.tabGroups.all.length, 3);
    assert.deepEqual(tabsIn(1).map(t => t.uri), [uriOf('user.txt')]);
    assert.deepEqual(tabsIn(2), []);
    assert.deepEqual(tabsIn(3).map(t => t.uri), [uriOf('other.txt')]);
  });

  test('an emptied group in a main-stack layout is put back in its place', async () => {
    const shape = (layout: EditorLayout): number[] => layout.groups.map(g => g.groups?.length ?? 0);
    await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{}, { groups: [{}, {}] }] });
    const before = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    await openUser('user.txt', 1);
    await openUser('other.txt', 3);
    await renderer.open({ ...deck, views: [{ layout: 'cols2', panes: [{ path: file('user.txt') }, { path: file('a.txt') }] }] }, 1);
    await renderer.close();
    const after = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    assert.deepEqual(shape(after), shape(before));
    assert.deepEqual(tabsIn(2), []);
    assert.deepEqual(tabsIn(3).map(t => t.uri), [uriOf('other.txt')]);
  });

  test('a smaller view keeps the group of a tab the user opened in it', async () => {
    await renderer.open(deck, 3);
    await openUser('user.txt', 3);
    await renderer.step(-1);
    const open = vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => (t.input as vscode.TabInputText).uri.toString());
    assert.deepEqual(open.sort(), [uriOf('c.txt'), uriOf('d.txt'), uriOf('user.txt')].sort());
    assert.equal(vscode.window.tabGroups.all.length, 3);
    assert.deepEqual(tabsIn(3).map(t => t.uri), [uriOf('user.txt')]);
  });

  test("a file the user reopens after closing show-me's tab for it is theirs", async () => {
    await renderer.open(deck, 1);
    const created = vscode.window.tabGroups.all[0]!.tabs.find(t => (t.input as vscode.TabInputText).uri.toString() === uriOf('a.txt'))!;
    await vscode.window.tabGroups.close(created);
    await openUser('a.txt', 1);
    await renderer.step(2);
    await renderer.close();
    assert.deepEqual(tabsIn(1).map(t => t.uri), [uriOf('a.txt')]);
  });

  test('restores a window whose groups were not created in column order', async () => {
    await openUser('user.txt', 1);
    await openUser('other.txt', 1);
    await vscode.commands.executeCommand('workbench.action.newGroupLeft');
    await renderer.open({ ...deck, views: [{ layout: 'cols2', panes: [{ path: file('a.txt') }, { path: file('user.txt') }] }] }, 1);
    await renderer.close();
    assert.equal(vscode.window.tabGroups.all.length, 2);
    assert.deepEqual(tabsIn(1), []);
    assert.deepEqual(tabsIn(2).map(t => t.uri), [uriOf('user.txt'), uriOf('other.txt')]);
    assert.equal(tabsIn(2).find(t => t.active)?.uri, uriOf('other.txt'));
  });

  test('close leaves alone a group of show-me\'s holding a file the user opened there', async () => {
    await openUser('user.txt', 1);
    await renderer.open(deck, 3);
    await openUser('other.txt', 2);
    await renderer.close();
    assert.deepEqual(tabsIn(1).map(t => t.uri), [uriOf('user.txt')]);
    assert.deepEqual(tabsIn(2).map(t => ({ uri: t.uri, preview: t.preview })), [{ uri: uriOf('other.txt'), preview: false }]);
    assert.equal(vscode.window.tabGroups.all.length, 2);
  });

  test('a user preview tab in a group show-me added stays a preview, in its group', async () => {
    const ids = new GroupIds(vscode.window.createOutputChannel('show-me test ids', { log: true }));
    await openUser('user.txt', 1);
    await renderer.open(deck, 3);
    await openUser('other.txt', 3, true);
    const groupId = ids.of(vscode.window.tabGroups.all.find(g => g.viewColumn === 3)!)!;
    await renderer.close();
    const group = ids.group(groupId);
    assert.ok(group, "the user's preview tab's group survives");
    assert.deepEqual(group.tabs.map(t => [(t.input as vscode.TabInputText).uri.toString(), t.isPreview]), [[uriOf('other.txt'), true]]);
    ids.dispose();
  });

  test('a group the user split off survives stepping to a view with as many panes', async () => {
    const ids = new GroupIds(vscode.window.createOutputChannel('show-me test ids', { log: true }));
    await openUser('user.txt', 1);
    await renderer.open(deck, 2);
    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await vscode.commands.executeCommand('workbench.action.splitEditorRight');
    const split = vscode.window.tabGroups.activeTabGroup;
    const splitId = ids.of(split)!;
    assert.equal(split.viewColumn, 3);
    await renderer.step(1);
    await renderer.close();
    const group = ids.group(splitId);
    assert.ok(group, 'the split-off group survives');
    assert.deepEqual(group.tabs.map(t => (t.input as vscode.TabInputText).uri.toString()), [uriOf('d.txt')]);
    ids.dispose();
  });

  test('views opened without waiting for each other still restore the user\'s window', async () => {
    await openUser('user.txt', 1);
    await Promise.all([renderer.open(deck, 3), renderer.open(deck, 1)]);
    await renderer.close();
    assert.equal(vscode.window.tabGroups.all.length, 1);
    assert.deepEqual(tabsIn(1).map(t => t.uri), [uriOf('user.txt')]);
  });

  test("a created tab the user pinned is theirs and stays open", async () => {
    await renderer.open(deck, 1);
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    await renderer.close();
    assert.deepEqual(tabsIn(1).map(t => t.uri), [uriOf('a.txt')]);
  });

  test('a group the user moves during a view keeps its tabs', async () => {
    await openUser('user.txt', 1);
    await renderer.open(deck, 2);
    await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
    await vscode.commands.executeCommand('workbench.action.moveActiveEditorGroupLeft');
    await renderer.close();
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => (t.input as vscode.TabInputText).uri.toString());
    assert.equal(tabs.filter(uri => uri === uriOf('user.txt')).length, 1);
  });
});
