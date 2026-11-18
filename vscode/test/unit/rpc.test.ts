import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Reply, Request } from '../../src/core/protocol.gen.ts';
import { Rpc } from '../../src/core/rpc.ts';
import { Session } from '../../src/core/session.ts';
import type { Deck } from '../../src/core/store.ts';

const TOKEN = 'a'.repeat(64);
const pane = { path: '/w/a.txt', first: 1, last: 2 };

function setup() {
  const session = new Session(mkdtempSync(join(tmpdir(), 'sm')), () => {});
  session.setFolders(['/w', '/w2']);
  const announced: Deck[] = [];
  const rpc = new Rpc({ token: TOKEN, session, openHint: 'ctrl+alt+v 1', announce: d => announced.push(d), now: () => 1792224000000 });
  const send = (req: Partial<Request> & { token?: unknown }): Reply => JSON.parse(rpc.handle(JSON.stringify({ protocol: 1, token: TOKEN, ...req })));
  return { session, announced, rpc, send };
}

test('a full session, with reply shapes identical to Neovim', () => {
  const { send, announced } = setup();
  assert.deepEqual(send({ command: 'status' }), { ok: true, result: { editor: 'vscode', workspace_folders: ['/w', '/w2'], current: null } });
  assert.deepEqual(send({ command: 'deck', title: 'How' }), { ok: true, result: { deck: 1 } });
  assert.deepEqual(send({ command: 'view', deck: 1, view: { layout: 'single', panes: [pane] } }), { ok: true, result: { view: 1 } });
  assert.deepEqual(send({ command: 'done', deck: 1 }), { ok: true, result: { deck: 1, views: 1, open_hint: 'ctrl+alt+v 1' } });
  assert.equal(announced[0]?.title, 'How');
  assert.deepEqual(send({ command: 'status' }).result, { editor: 'vscode', workspace_folders: ['/w', '/w2'], current: { deck: 1, title: 'How', views: 1 } });
});

test('a wrong or missing token is refused before anything else', () => {
  const { send } = setup();
  assert.deepEqual(send({ command: 'status', token: 'b'.repeat(64) }), { ok: false, error: 'bad token' });
  assert.deepEqual(send({ command: 'status', token: undefined }), { ok: false, error: 'bad token' });
  assert.deepEqual(send({ command: 'status', token: 'short', protocol: 2 }), { ok: false, error: 'bad token' });
});

test('protocol, command and JSON errors', () => {
  const { send, rpc } = setup();
  assert.deepEqual(send({ protocol: 2, command: 'status' }), { ok: false, error: 'unsupported protocol 2 (this editor speaks 1)' });
  assert.deepEqual(send({ command: 'dance' as Request['command'] }), { ok: false, error: 'unknown command "dance"' });
  assert.deepEqual(JSON.parse(rpc.handle('{nope')), { ok: false, error: 'request is not JSON' });
});

test('editor-side rejections come back as errors', () => {
  const { send } = setup();
  assert.deepEqual(send({ command: 'view', deck: 99, view: { layout: 'single', panes: [pane] } }), { ok: false, error: 'unknown deck 99' });
});

test('keeps an unfinished deck in its store when folders change', () => {
  const { send, session } = setup();
  send({ command: 'deck', title: 'Started in /w' });
  session.setFolders(['/elsewhere']);
  assert.deepEqual(send({ command: 'view', deck: 1, view: { layout: 'single', panes: [pane] } }), { ok: true, result: { view: 1 } });
  assert.deepEqual(send({ command: 'done', deck: 1 }).ok, true);
  session.setFolders(['/w']);
  assert.equal(session.store().latestDone()?.title, 'Started in /w');
});

test('a window with no folder refuses decks', () => {
  const { send, session } = setup();
  session.setFolders([]);
  assert.deepEqual(send({ command: 'deck', title: 'x' }), { ok: false, error: 'this VS Code window has no folder open' });
  assert.deepEqual(send({ command: 'status' }).result, { editor: 'vscode', workspace_folders: [], current: null });
});
