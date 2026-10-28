import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the extension version equals the repository VERSION', () => {
  const manifest: { version: string } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const version = readFileSync(new URL('../../../VERSION', import.meta.url), 'utf8').trim();
  assert.equal(manifest.version, version);
});

test('the generated types match the Go protocol', () => {
  const generated = readFileSync(new URL('../../src/core/protocol.gen.ts', import.meta.url), 'utf8');
  assert.match(generated, /command: "deck" \| "view" \| "done" \| "status";/);
  assert.match(generated, /current: CurrentDeck \| null;/);
});
