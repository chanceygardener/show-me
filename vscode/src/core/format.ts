/** Every user-facing string show-me builds from a deck, in one place. */
import type { Pane } from './protocol.gen.ts';
import type { Deck } from './store.ts';

/** How the user opens view 1 with the default keybindings. */
export const OPEN_HINT = 'ctrl+alt+v 1';

export type DeckPickItem = { label: string; description: string; detail: string; deck: Deck };

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function rangeSuffix(pane: Pane): string {
  return pane.first === undefined ? '' : `:${pane.first}-${pane.last ?? pane.first}`;
}

/** `n/N · <view title or deck title> · <relative path>:<range>` */
export function caption(deck: Deck, n: number, pane: Pane, relativePath: string): string {
  return `${n}/${deck.views.length} · ${deck.views[n - 1]?.title || deck.title} · ${relativePath}${rangeSuffix(pane)}`;
}

export function doneNotice(deck: Deck, openHint: string): string {
  return `show-me: ${deck.title} · ${plural(deck.views.length, 'view')} · ${openHint}`;
}

export function noSuchView(deck: Deck): string {
  return `show-me: "${deck.title}" has ${plural(deck.views.length, 'view')}`;
}

export function deckPickItem(deck: Deck): DeckPickItem {
  return {
    label: deck.title,
    description: plural(deck.views.length, 'view'),
    detail: deck.views.map((view, i) => `${i + 1}. ${view.title || view.layout}`).join('  '),
    deck,
  };
}
