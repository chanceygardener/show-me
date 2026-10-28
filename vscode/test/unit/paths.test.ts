import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { baseDir, ensurePrivateDir, findCli, SocketPathTooLong, socketAddress } from '../../src/core/paths.ts';

test('SHOW_ME_HOME wins', () => {
  assert.equal(baseDir({ SHOW_ME_HOME: '/x', XDG_STATE_HOME: '/y' }, 'linux', '/h'), '/x');
});

test('XDG_STATE_HOME, then ~/.local/state; empty counts as unset', () => {
  assert.equal(baseDir({ XDG_STATE_HOME: '/y' }, 'darwin', '/h'), '/y/show-me');
  assert.equal(baseDir({ SHOW_ME_HOME: '', XDG_STATE_HOME: '' }, 'linux', '/h'), '/h/.local/state/show-me');
});

test('Windows uses LOCALAPPDATA', () => {
  assert.equal(baseDir({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'win32', 'C:\\Users\\me'), 'C:\\Users\\me\\AppData\\Local\\show-me');
  assert.throws(() => baseDir({}, 'win32', 'C:\\Users\\me'), /LOCALAPPDATA/);
});

test('socket addresses', () => {
  assert.equal(socketAddress('/s', 42, 'linux'), '/s/sock/vscode-42.sock');
  assert.equal(socketAddress('C:\\s', 42, 'win32', 'ab12cd34'), '\\\\.\\pipe\\show-me-vscode-42-ab12cd34');
});

test('refuses a socket path over the limit', () => {
  assert.throws(() => socketAddress('/' + 'd'.repeat(100), 42, 'darwin'), SocketPathTooLong);
});

test('private dirs are 0700 on POSIX', { skip: process.platform === 'win32' }, () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'sm')), 'a', 'b');
  ensurePrivateDir(dir);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test('finds the CLI on PATH, then in <base>/bin', () => {
  const have = new Set(['/usr/local/bin/show-me', '/base/bin/show-me']);
  const exists = (p: string) => have.has(p);
  assert.equal(findCli({ PATH: '/usr/bin:/usr/local/bin' }, 'linux', '/base', exists), '/usr/local/bin/show-me');
  assert.equal(findCli({ PATH: '/usr/bin' }, 'linux', '/base', exists), '/base/bin/show-me');
  assert.equal(findCli({ PATH: '/usr/bin' }, 'linux', '/elsewhere', exists), undefined);
  assert.equal(findCli({ Path: 'C:\\bin' }, 'win32', 'C:\\b', p => p === 'C:\\bin\\show-me.exe'), 'C:\\bin\\show-me.exe');
});
