import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Entry } from '../../src/core/protocol.gen.ts';
import { Registry } from '../../src/core/registry.ts';

const fields = {
  protocol: 1, editor: 'vscode' as const, pid: 4242, workspace_folders: ['/w'],
  transport: { kind: 'ndjson' as const, address: '/s/sock/vscode-4242.sock', token: 'f'.repeat(64) },
  open_hint: 'ctrl+alt+v 1',
};

const read = (file: string): Entry => JSON.parse(readFileSync(file, 'utf8'));

test('writes <base>/editors/vscode-<pid>.json atomically, mode 0600', () => {
  const base = mkdtempSync(join(tmpdir(), 'sm'));
  const registry = new Registry(base, fields, 1000);
  registry.write();
  assert.equal(registry.file, join(base, 'editors', 'vscode-4242.json'));
  assert.deepEqual(read(registry.file), { ...fields, started_at: 1000, focused_at: 1000 });
  assert.deepEqual(readdirSync(join(base, 'editors')), ['vscode-4242.json']);
  if (process.platform !== 'win32') assert.equal(statSync(registry.file).mode & 0o777, 0o600);
});

test('touch moves focused_at; setFolders rewrites the folders', () => {
  const registry = new Registry(mkdtempSync(join(tmpdir(), 'sm')), fields, 1000);
  registry.write();
  registry.touch(2000);
  registry.setFolders(['/a', '/b']);
  const entry = read(registry.file);
  assert.equal(entry.started_at, 1000);
  assert.equal(entry.focused_at, 2000);
  assert.deepEqual(entry.workspace_folders, ['/a', '/b']);
});

test('remove deletes the entry', () => {
  const registry = new Registry(mkdtempSync(join(tmpdir(), 'sm')), fields, 1000);
  registry.write();
  registry.remove();
  assert.equal(existsSync(registry.file), false);
});
