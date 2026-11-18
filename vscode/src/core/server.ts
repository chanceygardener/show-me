/**
 * The ndjson transport's server end: one request line in, one reply line out,
 * then the connection closes. A Unix socket in a private directory, or a
 * named pipe on Windows (where the token is the only protection).
 */
import { chmodSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { dirname } from 'node:path';
import { ensurePrivateDir } from './paths.ts';

/** A request longer than this is dropped; real ones are a few hundred bytes. */
export const MAX_REQUEST_BYTES = 1 << 20;

/** The CLI gives up after 10 s, so a connection held longer is abandoned. */
export const REQUEST_TIMEOUT_MS = 10_000;

export class NdjsonServer {
  readonly address: string;
  readonly #server: Server;
  readonly #platform: NodeJS.Platform;

  private constructor(address: string, server: Server, platform: NodeJS.Platform) {
    this.address = address;
    this.#server = server;
    this.#platform = platform;
  }

  static async listen(address: string, handle: (line: string) => string, platform: NodeJS.Platform = process.platform): Promise<NdjsonServer> {
    if (platform !== 'win32') {
      ensurePrivateDir(dirname(address), platform);
      // A crashed window whose pid was reused leaves its socket file behind.
      rmSync(address, { force: true });
    }
    const server = createServer(socket => NdjsonServer.#serve(socket, handle));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(address, () => {
        server.off('error', reject);
        resolve();
      });
    });
    if (platform !== 'win32') chmodSync(address, 0o600);
    return new NdjsonServer(address, server, platform);
  }

  close(): void {
    this.#server.close();
    if (this.#platform !== 'win32') rmSync(this.address, { force: true });
  }

  static #serve(socket: Socket, handle: (line: string) => string): void {
    let buffered = '';
    socket.setEncoding('utf8');
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      const end = buffered.indexOf('\n');
      if (end < 0) {
        if (buffered.length > MAX_REQUEST_BYTES) socket.destroy();
        return;
      }
      socket.removeAllListeners('data');
      socket.end(`${handle(buffered.slice(0, end))}\n`);
    });
  }
}
