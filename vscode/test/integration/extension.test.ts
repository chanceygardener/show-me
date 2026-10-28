import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { ShowMeApi } from '../../src/extension.ts';

suite('activation', () => {
  test('registers an ndjson entry for this window', async () => {
    const extension = vscode.extensions.all.find(e => e.packageJSON.name === 'show-me')!;
    const api: ShowMeApi = await extension.activate();
    assert.ok(existsSync(api.registryFile));
    const entry = JSON.parse(readFileSync(api.registryFile, 'utf8'));
    assert.equal(entry.editor, 'vscode');
    assert.equal(entry.transport.kind, 'ndjson');
    assert.match(entry.transport.token, /^[0-9a-f]{64}$/);
    assert.equal(entry.open_hint, 'ctrl+alt+v 1');
    const before = entry.focused_at;
    await new Promise(r => setTimeout(r, 5));
    api.touch();
    assert.ok(JSON.parse(readFileSync(api.registryFile, 'utf8')).focused_at > before);
  });

  test('every documented command exists', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const name of [...Array.from({ length: 9 }, (_, i) => `showMe.openView${i + 1}`), 'showMe.next', 'showMe.previous', 'showMe.pickDeck', 'showMe.close']) {
      assert.ok(commands.includes(name), name);
    }
  });
});
