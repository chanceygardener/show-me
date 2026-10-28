/**
 * The show-me protocol endpoint: one request line in, one reply line out,
 * shaped as in protocol/PROTOCOL.md and identical to lua/show_me/rpc.lua.
 * Never throws: every failure is an `ok: false` reply.
 */
import { timingSafeEqual } from 'node:crypto';
import type { DeckResult, DoneResult, Reply, Request, StatusResult, ViewResult } from './protocol.gen.ts';
import type { Session } from './session.ts';
import { Rejection } from './store.ts';
import type { Deck } from './store.ts';

/** The protocol version this extension speaks. */
export const PROTOCOL = 1;

export type RpcOptions = {
  token: string;
  session: Session;
  openHint: string;
  /** Tell the user a deck is done. Must not block or take focus. */
  announce: (deck: Deck) => void;
  now?: () => number;
};

type Handler = (request: Request) => DeckResult | ViewResult | DoneResult | StatusResult;

export class Rpc {
  readonly #options: RpcOptions;
  readonly #commands: Record<Request['command'], Handler>;

  constructor(options: RpcOptions) {
    this.#options = options;
    const { session } = options;
    this.#commands = {
      deck: ({ title }) => {
        const store = session.store();
        const { id } = store.create(title ?? '', (options.now ?? Date.now)());
        session.remember(id, store);
        return { deck: id };
      },
      view: ({ deck, view }) => ({ view: session.storeFor(deck).addView(deck, view!) }),
      done: ({ deck }) => {
        const finished = session.storeFor(deck).finish(deck);
        session.forget(finished.id);
        session.setCurrent(finished);
        options.announce(finished);
        return { deck: finished.id, views: finished.views.length, open_hint: options.openHint };
      },
      status: () => {
        const current = session.current();
        return {
          editor: 'vscode',
          workspace_folders: [...session.folders],
          current: current ? { deck: current.id, title: current.title, views: current.views.length } : null,
        };
      },
    };
  }

  handle(line: string): string {
    let request: Request;
    try {
      request = JSON.parse(line);
    } catch {
      return Rpc.#reply({ ok: false, error: 'request is not JSON' });
    }
    if (typeof request !== 'object' || request === null) return Rpc.#reply({ ok: false, error: 'request is not JSON' });
    if (!Rpc.#tokenMatches(request.token, this.#options.token)) return Rpc.#reply({ ok: false, error: 'bad token' });
    if (request.protocol !== PROTOCOL) {
      return Rpc.#reply({ ok: false, error: `unsupported protocol ${request.protocol} (this editor speaks ${PROTOCOL})` });
    }
    const command = Object.hasOwn(this.#commands, request.command) ? this.#commands[request.command] : undefined;
    if (!command) return Rpc.#reply({ ok: false, error: `unknown command ${JSON.stringify(request.command)}` });
    try {
      return Rpc.#reply({ ok: true, result: command(request) });
    } catch (error) {
      if (error instanceof Rejection) return Rpc.#reply({ ok: false, error: error.message });
      return Rpc.#reply({ ok: false, error: `internal error: ${error}` });
    }
  }

  static #reply(reply: Reply): string {
    return JSON.stringify(reply);
  }

  static #tokenMatches(given: unknown, expected: string): boolean {
    if (typeof given !== 'string') return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
