import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caption, deckPickItem, doneNotice, noSuchView, rangeSuffix } from '../../src/core/format.ts';
import type { Deck } from '../../src/core/store.ts';

const deck: Deck = {
  id: 7, title: 'How it works', created_at: 0, done: true,
  views: [
    { layout: 'cols2', title: 'Both', panes: [{ path: '/w/a.py', first: 2, last: 4 }, { path: '/w/b.py' }] },
    { layout: 'single', panes: [{ path: '/w/a.py', first: 5, last: 5 }] },
  ],
};

test('caption uses the view title, else the deck title', () => {
  assert.equal(caption(deck, 1, deck.views[0]!.panes[0]!, 'a.py'), '1/2 · Both · a.py:2-4');
  assert.equal(caption(deck, 2, deck.views[1]!.panes[0]!, 'a.py'), '2/2 · How it works · a.py:5-5');
});

test('no range, no suffix', () => {
  assert.equal(rangeSuffix({ path: '/w/b.py' }), '');
});

test('the done notice pluralises views', () => {
  assert.equal(doneNotice(deck, 'ctrl+alt+v 1'), 'show-me: How it works · 2 views · ctrl+alt+v 1');
  assert.equal(doneNotice({ ...deck, views: [deck.views[0]!] }, 'k'), 'show-me: How it works · 1 view · k');
});

test('asking for a view past the end names the count', () => {
  assert.equal(noSuchView(deck), 'show-me: "How it works" has 2 views');
});

test('picker items', () => {
  assert.deepEqual(deckPickItem(deck), {
    label: 'How it works', description: '2 views', detail: '1. Both  2. single', deck,
  });
});
