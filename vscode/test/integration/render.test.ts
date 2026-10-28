import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { Renderer } from '../../src/render.ts';
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
});
