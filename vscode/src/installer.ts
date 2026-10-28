/**
 * The extension never downloads the CLI itself: files VS Code writes may be
 * quarantined on macOS. When the CLI is missing it offers to run the
 * installer one-liner in a terminal instead.
 */
import * as vscode from 'vscode';
import { findCli } from './core/paths.ts';

const RELEASES = 'https://github.com/chanceygardener/show-me/releases/latest/download';
const DISMISSED = 'showMe.installerDismissed';

export async function offerInstaller(context: vscode.ExtensionContext, base: string): Promise<void> {
  if (context.globalState.get<boolean>(DISMISSED) || findCli(process.env, process.platform, base)) return;
  const choice = await vscode.window.showInformationMessage('show-me: agents need the show-me CLI to reach this editor.', 'Run installer', "Don't ask again");
  if (choice === "Don't ask again") return void (await context.globalState.update(DISMISSED, true));
  if (choice !== 'Run installer') return;
  const windows = process.platform === 'win32';
  const terminal = vscode.window.createTerminal({ name: 'show-me installer', shellPath: windows ? 'powershell.exe' : undefined });
  terminal.show();
  terminal.sendText(windows ? `irm ${RELEASES}/install.ps1 | iex` : `curl -fsSL ${RELEASES}/install.sh | sh`);
}
