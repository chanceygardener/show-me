import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import type { View } from '../../src/core/protocol.gen.ts';
import { KEEP, MAX_VIEWS, Rejection, Store, workspaceKey } from '../../src/core/store.ts';

const view: View = { layout: 'single', panes: [{ path: '/a.txt' }] };

function fresh(logged: string[] = []): Store {
  return Store.forWorkspace(mkdtempSync(join(tmpdir(), 'sm')), '/w', m => logged.push(m));
}

test('one directory per workspace, named by 16 hex characters of sha256', () => {
  assert.equal(workspaceKey('/w'), createHash('sha256').update('/w').digest('hex').slice(0, 16));
  assert.match(workspaceKey('/w'), /^[0-9a-f]{16}$/);
  assert.equal(basename(fresh().root), workspaceKey('/w'));
});

test('ids are monotonic from 1 and survive pruning', () => {
  const store = fresh();
  for (let i = 1; i <= KEEP + 2; i++) assert.equal(store.create(`d${i}`, i).id, i);
  assert.deepEqual(store.ids(), Array.from({ length: KEEP }, (_, i) => i + 3));
  assert.equal(store.create('next', 99).id, KEEP + 3);
});

test('editor-side rejections, verbatim', () => {
  const store = fresh();
  const reject = (fn: () => unknown, message: string) => assert.throws(fn, (e: unknown) => e instanceof Rejection && e.message === message);
  reject(() => store.addView(99, view), 'unknown deck 99');
  const id = store.create('One', 1).id;
  reject(() => store.finish(id), `deck ${id} has no views`);
  for (let i = 1; i <= MAX_VIEWS; i++) assert.equal(store.addView(id, view), i);
  reject(() => store.addView(id, view), `deck ${id} already has 9 views, the most an editor can open by number`);
  store.finish(id);
  reject(() => store.addView(id, view), `deck ${id} is already done; start a new one`);
});

test('a corrupt deck file is skipped and logged', () => {
  const logged: string[] = [];
  const store = fresh(logged);
  const good = store.create('good', 1);
  store.addView(good.id, view);
  store.finish(good.id);
  writeFileSync(join(store.root, '2.json'), '{not json');
  assert.equal(store.latestDone()?.id, good.id);
  assert.equal(store.create('after', 3).id, 3);
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /2\.json/);
});

test('listDone is newest first and skips unfinished decks', () => {
  const store = fresh();
  for (const title of ['a', 'b', 'c']) {
    const d = store.create(title, 1);
    store.addView(d.id, view);
    if (title !== 'b') store.finish(d.id);
  }
  assert.deepEqual(store.listDone().map(d => d.title), ['c', 'a']);
});

test('decks persist with epoch-ms created_at', () => {
  const store = fresh();
  const d = store.create('kept', 1792224000000);
  assert.deepEqual(new Store(store.root, () => {}).get(d.id), { ...d });
  assert.equal(Number.isInteger(store.get(d.id).created_at), true);
});
