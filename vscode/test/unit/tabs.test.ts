import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TabLedger } from '../../src/core/tabs.ts';

const a1 = { column: 1, uri: 'file:///a' };
const b2 = { column: 2, uri: 'file:///b' };
const u1 = { column: 1, uri: 'file:///user' };

test('only created tabs are released for closing', () => {
  const ledger = new TabLedger();
  ledger.record(a1, false);
  ledger.record(u1, true);
  assert.deepEqual(ledger.release(), [a1]);
  assert.deepEqual(ledger.borrowed, []);
});

test('tabs the next view reuses stay open and stay created', () => {
  const ledger = new TabLedger();
  ledger.record(a1, false);
  ledger.record(b2, false);
  assert.deepEqual(ledger.release([a1]), [b2]);
  ledger.record(a1, true);
  assert.equal(ledger.isCreated(a1), true);
  assert.deepEqual(ledger.release(), [a1]);
});

test('the same file in another group is a different tab', () => {
  const ledger = new TabLedger();
  ledger.record(a1, false);
  assert.deepEqual(ledger.release([{ column: 2, uri: a1.uri }]), [a1]);
});

test('a borrowed tab is never released, even when it is not reused', () => {
  const ledger = new TabLedger();
  ledger.record(u1, true);
  assert.deepEqual(ledger.release([a1]), []);
  assert.deepEqual(ledger.release(), []);
});
