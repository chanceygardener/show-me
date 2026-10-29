import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

test('nothing in src/core imports vscode, so it runs under plain Node', () => {
  const dir = new URL('../../src/core/', import.meta.url);
  for (const name of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(new URL(name, dir), 'utf8'), /from ['"]vscode['"]/, name);
  }
});
