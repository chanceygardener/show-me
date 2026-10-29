/**
 * show-me for VS Code: lets terminal coding agents illustrate explanations
 * in this window. The agent's `show-me` CLI finds the window through its
 * registry entry and sends requests over an ndjson socket or pipe. Decks
 * are stored per workspace folder; views are laid over the current window.
 * Nothing here moves focus on its own.
 */
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { OPEN_HINT } from './core/format.ts';
import { baseDir, resolveFolder, socketAddress } from './core/paths.ts';
import { Registry } from './core/registry.ts';
import { PROTOCOL, Rpc } from './core/rpc.ts';
import { NdjsonServer } from './core/server.ts';
import { Session } from './core/session.ts';
import { offerInstaller } from './installer.ts';
import { Navigator } from './navigator.ts';
import { Renderer } from './render.ts';

/** Returned from activate for the test harness; not a public API. */
export type ShowMeApi = { touch(): void; registryFile: string };

const workspaceFolders = (): string[] =>
  (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => resolveFolder(f.uri.fsPath));

export async function activate(context: vscode.ExtensionContext): Promise<ShowMeApi> {
  const log = vscode.window.createOutputChannel('show-me', { log: true });
  const session = new Session(context.globalStorageUri.fsPath, message => log.warn(message));
  session.setFolders(workspaceFolders());
  const renderer = new Renderer(log);
  const navigator = new Navigator(session, renderer, log);
  const token = randomBytes(32).toString('hex');
  const rpc = new Rpc({ token, session, openHint: OPEN_HINT, announce: deck => navigator.announce(deck) });
  const base = baseDir();
  const registry = await serve(context, base, token, rpc, log);
  const update = (change: (r: Registry) => void): void => {
    if (!registry) return;
    try {
      change(registry);
    } catch (error) {
      log.warn(`could not update the registry entry: ${error}`);
    }
  };

  context.subscriptions.push(
    log,
    renderer,
    ...navigator.register(),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      session.setFolders(workspaceFolders());
      update(r => r.setFolders([...session.folders]));
    }),
    vscode.window.onDidChangeWindowState(state => state.focused && update(r => r.touch(Date.now()))),
  );
  void offerInstaller(context, base);
  return { touch: () => update(r => r.touch(Date.now())), registryFile: registry?.file ?? '' };
}

/**
 * Start the ndjson server and publish the registry entry; deactivation undoes both.
 * Returns undefined, after warning the user, when agents can't be served
 * (for example a socket path over the Unix limit).
 */
async function serve(context: vscode.ExtensionContext, base: string, token: string, rpc: Rpc, log: vscode.LogOutputChannel): Promise<Registry | undefined> {
  try {
    const address = socketAddress(base, process.pid, process.platform, randomBytes(4).toString('hex'));
    const server = await NdjsonServer.listen(address, line => rpc.handle(line));
    const registry = new Registry(base, {
      protocol: PROTOCOL,
      editor: 'vscode',
      pid: process.pid,
      workspace_folders: workspaceFolders(),
      transport: { kind: 'ndjson', address, token },
      open_hint: OPEN_HINT,
    }, Date.now());
    context.subscriptions.push({ dispose: () => { registry.remove(); server.close(); } });
    registry.write();
    return registry;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.error(`agents cannot reach this window: ${reason}`);
    void vscode.window.showWarningMessage(`show-me: agents cannot reach this window: ${reason}`);
    return undefined;
  }
}
