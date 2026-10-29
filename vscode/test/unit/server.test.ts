import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NdjsonServer } from '../../src/core/server.ts';

function address(): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\show-me-test-${process.pid}-${Math.random().toString(16).slice(2)}`
    : join(mkdtempSync(join(tmpdir(), 'sm')), 'sock', 't.sock');
}

function ask(addr: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(addr, () => socket.write(line));
    let reply = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => (reply += chunk));
    socket.on('end', () => resolve(reply));
    socket.on('error', reject);
  });
}

test('answers one line with one line, then closes', async () => {
  const server = await NdjsonServer.listen(address(), line => `echo ${line}`);
  try {
    assert.equal(await ask(server.address, '{"a":1}\n'), 'echo {"a":1}\n');
    assert.equal(await ask(server.address, 'x\ny\n'), 'echo x\n');
  } finally {
    server.close();
  }
});

test('replaces a stale socket file', { skip: process.platform === 'win32' }, async () => {
  const addr = address();
  const first = await NdjsonServer.listen(addr, () => 'one');
  first.close();
  writeFileSync(addr, '');
  const second = await NdjsonServer.listen(addr, () => 'two');
  try {
    assert.equal(await ask(addr, '\n'), 'two\n');
  } finally {
    second.close();
  }
});
