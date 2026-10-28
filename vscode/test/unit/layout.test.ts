import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutFor, shouldApplyLayout } from '../../src/core/layout.ts';

test('columns split the width evenly, left to right', () => {
  assert.deepEqual(layoutFor('single', 1), { orientation: 0, groups: [{ size: 1 }] });
  assert.deepEqual(layoutFor('cols2', 2), { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
  assert.deepEqual(layoutFor('cols3', 3), { orientation: 0, groups: [{ size: 1 / 3 }, { size: 1 / 3 }, { size: 1 / 3 }] });
});

test('main-stack: pane 1 takes 60% on the left, the rest stack on the right', () => {
  assert.deepEqual(layoutFor('main-stack', 3), { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4, groups: [{}, {}] }] });
  assert.deepEqual(layoutFor('main-stack', 4), { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4, groups: [{}, {}, {}] }] });
});

test('never shrink: the layout applies only when it removes none of the user\'s groups', () => {
  assert.equal(shouldApplyLayout(1, 3), true);
  assert.equal(shouldApplyLayout(3, 3), true);
  assert.equal(shouldApplyLayout(4, 2), false);
});
