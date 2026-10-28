/**
 * Where show-me lives on disk, shared with the CLI (internal/registry.BaseDir),
 * and how this window's socket is named.
 */
import { chmodSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export type Env = Record<string, string | undefined>;

/** sun_path holds 104 bytes on macOS (108 on Linux), including the NUL. */
export const MAX_SOCKET_PATH = 103;

export class SocketPathTooLong extends Error {
  override name = 'SocketPathTooLong';
}

const isSet = (value: string | undefined): value is string => value !== undefined && value !== '';
const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix);

/** show-me's home. Empty variables count as unset. */
export function baseDir(env: Env = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  const path = pathFor(platform);
  if (isSet(env.SHOW_ME_HOME)) return env.SHOW_ME_HOME;
  if (platform === 'win32') {
    if (!isSet(env.LOCALAPPDATA)) throw new Error('LOCALAPPDATA is not set');
    return path.join(env.LOCALAPPDATA, 'show-me');
  }
  return path.join(isSet(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(home, '.local', 'state'), 'show-me');
}

/** A Unix socket under `<base>/sock`, or a named pipe on Windows (pipes aren't files, so the name is randomised). */
export function socketAddress(base: string, pid: number, platform: NodeJS.Platform = process.platform, random = ''): string {
  if (platform === 'win32') return `\\\\.\\pipe\\show-me-vscode-${pid}-${random}`;
  const address = posix.join(base, 'sock', `vscode-${pid}.sock`);
  if (Buffer.byteLength(address) > MAX_SOCKET_PATH) {
    throw new SocketPathTooLong(`socket path ${address} is longer than ${MAX_SOCKET_PATH} bytes; set SHOW_ME_HOME to a shorter directory`);
  }
  return address;
}

/** Create `dir` (and parents) readable only by this user, as the Neovim plugin does. */
export function ensurePrivateDir(dir: string, platform: NodeJS.Platform = process.platform): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') chmodSync(dir, 0o700);
}

/** Workspace folders are published symlink-resolved, like Neovim's fs_realpath. */
export function resolveFolder(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The show-me CLI on PATH, else the installer's copy under `<base>/bin`. */
export function findCli(env: Env, platform: NodeJS.Platform, base: string, exists: (p: string) => boolean = existsSync): string | undefined {
  const path = pathFor(platform);
  const name = platform === 'win32' ? 'show-me.exe' : 'show-me';
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(isSet);
  return [...dirs, path.join(base, 'bin')].map(dir => path.join(dir, name)).find(exists);
}
