// Generated from protocol/schema.json by scripts/gen-types.mjs. Do not edit.

/**
 * show-me protocol 1. Generated from internal/protocol; do not edit.
 */
export interface ShowMeProtocol {
  request: Request;
  reply: Reply;
  deck_result: DeckResult;
  view_result: ViewResult;
  done_result: DoneResult;
  status_result: StatusResult;
  entry: Entry;
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "Request".
 */
export interface Request {
  protocol: number;
  token?: string;
  command: "deck" | "view" | "done" | "status";
  title?: string;
  deck?: number;
  view?: View;
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "View".
 */
export interface View {
  layout: "single" | "cols2" | "cols3" | "main-stack";
  title?: string;
  panes: Pane[];
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "Pane".
 */
export interface Pane {
  path: string;
  first?: number;
  last?: number;
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "Reply".
 */
export interface Reply {
  ok: boolean;
  error?: string;
  result?: unknown;
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "DeckResult".
 */
export interface DeckResult {
  deck: number;
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "ViewResult".
 */
export interface ViewResult {
  view: number;
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "DoneResult".
 */
export interface DoneResult {
  deck: number;
  views: number;
  open_hint: string;
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "StatusResult".
 */
export interface StatusResult {
  editor: "nvim" | "vscode";
  workspace_folders: string[];
  current: CurrentDeck | null;
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "CurrentDeck".
 */
export interface CurrentDeck {
  deck: number;
  title: string;
  views: number;
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "Entry".
 */
export interface Entry {
  protocol: number;
  editor: "nvim" | "vscode";
  pid: number;
  workspace_folders: string[];
  transport: Transport;
  open_hint: string;
  started_at: number;
  focused_at: number;
}
/**
 * This interface was referenced by `ShowMeProtocol`'s JSON-Schema
 * via the `definition` "Transport".
 */
export interface Transport {
  kind: "nvim" | "ndjson";
  address: string;
  token?: string;
}
