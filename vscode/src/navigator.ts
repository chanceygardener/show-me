/**
 * What the user does with decks: open a view by number, step, pick a deck,
 * close; and the notification when an agent finishes one.
 */
import * as vscode from 'vscode';
import { deckPickItem, doneNotice, noSuchView, OPEN_HINT } from './core/format.ts';
import type { Session } from './core/session.ts';
import { Rejection } from './core/store.ts';
import type { Deck } from './core/store.ts';
import type { Renderer } from './render.ts';

export class Navigator {
  readonly #session: Session;
  readonly #renderer: Renderer;
  readonly #log: vscode.LogOutputChannel;

  constructor(session: Session, renderer: Renderer, log: vscode.LogOutputChannel) {
    this.#session = session;
    this.#renderer = renderer;
    this.#log = log;
  }

  register(): vscode.Disposable[] {
    const commands: Record<string, () => Promise<void>> = {
      ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`showMe.openView${i + 1}`, () => this.open(i + 1)])),
      'showMe.next': () => this.#renderer.step(1),
      'showMe.previous': () => this.#renderer.step(-1),
      'showMe.pickDeck': () => this.pick(),
      'showMe.close': () => this.#renderer.close(),
    };
    return Object.entries(commands).map(([name, run]) => vscode.commands.registerCommand(name, () => this.#guard(name, run)));
  }

  async open(n: number): Promise<void> {
    const deck = this.#session.current();
    if (!deck) {
      void vscode.window.showWarningMessage('show-me: no deck yet; ask an agent to show you something');
    } else if (!deck.views[n - 1]) {
      void vscode.window.showWarningMessage(noSuchView(deck));
    } else {
      await this.#renderer.open(deck, n);
    }
  }

  async pick(): Promise<void> {
    const decks = this.#session.folders.length > 0 ? this.#session.store().listDone() : [];
    if (decks.length === 0) {
      void vscode.window.showWarningMessage('show-me: no decks yet');
      return;
    }
    const picked = await vscode.window.showQuickPick(decks.map(deckPickItem), { title: 'show-me decks', matchOnDetail: true });
    if (picked) await this.#show(picked.deck);
  }

  /** Never awaited by the request handler, never takes focus, and never throws: the deck is already finished. */
  announce(deck: Deck): void {
    try {
      void vscode.window
        .showInformationMessage(doneNotice(deck, OPEN_HINT), 'Open view 1')
        .then(choice => (choice ? this.#guard('announce', () => this.#show(deck)) : undefined))
        .then(undefined, error => this.#log.error(`announce: ${String(error)}`));
    } catch (error) {
      this.#log.error(`announce: ${String(error)}`);
    }
  }

  async #show(deck: Deck): Promise<void> {
    this.#session.setCurrent(deck);
    await this.#renderer.open(deck, 1);
  }

  async #guard(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.#log.error(`${name}: ${error instanceof Rejection ? error.message : String(error)}`);
      void vscode.window.showErrorMessage(`show-me: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
