/**
 * The four show-me layouts as `vscode.setEditorLayout` arguments, the
 * never-shrink rule, and the shape of the snapshot taken before a view opens.
 * Group order in a layout is the viewColumn order: pane i opens in column i.
 */
import type { View } from './protocol.gen.ts';

export type GroupLayout = { size?: number; groups?: GroupLayout[] };

/** orientation 0 lays groups side by side; nested groups alternate. */
export type EditorLayout = { orientation: 0 | 1; groups: GroupLayout[] };

/** Share of the width the primary pane of `main-stack` takes. */
export const MAIN_SHARE = 0.6;

export type GroupSnapshot = { activeUri?: string; activePreview: boolean };

export type Snapshot = { layout: EditorLayout; groups: GroupSnapshot[]; activeColumn: number };

const columns = (count: number): GroupLayout[] => Array.from({ length: count }, () => ({ size: 1 / count }));

export function layoutFor(layout: View['layout'], panes: number): EditorLayout {
  switch (layout) {
    case 'main-stack':
      return { orientation: 0, groups: [{ size: MAIN_SHARE }, { size: 1 - MAIN_SHARE, groups: Array.from({ length: panes - 1 }, () => ({})) }] };
    case 'single':
    case 'cols2':
    case 'cols3':
      return { orientation: 0, groups: columns(panes) };
  }
}

/** Apply a view's layout only when it removes none of the user's own groups. */
export function shouldApplyLayout(userGroups: number, panes: number): boolean {
  return userGroups <= panes;
}

/** How many editor groups `layout` makes: one per leaf. */
export function groupCount(layout: EditorLayout | GroupLayout): number {
  return layout.groups?.length ? layout.groups.reduce((sum, group) => sum + groupCount(group), 0) : 1;
}
