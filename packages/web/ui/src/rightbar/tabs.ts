/**
 * The panel's tab vocabulary: one fixed page (文件) plus the file tabs opened
 * from its tree.
 *
 * The panel is deliberately ONE surface — a directory and a preview — because
 * the product is positioned as a general personal agent, not an IDE. The
 * previous strip also carried 变更 / 任务 / 终端 / a guide page; those were
 * coding-workbench affordances and have been removed rather than hidden.
 *
 * Pure: no React, no DOM, so the rules can be asserted directly.
 */

/** The one PAGE the panel offers. File tabs are not pages: they are documents. */
export type RightbarTabId = 'files';

/**
 * A file tab's strip id: `file:` + the ABSOLUTE path, which is the tab's whole
 * identity — a path is one tab; opening it again reveals the open one. The
 * prefix is namespaced so a page id can never collide with a path.
 */
export const FILE_TAB_PREFIX = 'file:';

/** The strip id of one file's tab. */
export function fileTabId(path: string): StripTabId {
  return `${FILE_TAB_PREFIX}${path}`;
}

/** Whether a strip id names a file tab. */
export function isFileTabId(id: StripTabId): boolean {
  return id.startsWith(FILE_TAB_PREFIX);
}

/** The path behind a file tab id (only meaningful when `isFileTabId`). */
export function filePathOf(id: StripTabId): string {
  return id.slice(FILE_TAB_PREFIX.length);
}

/** Anything the strip draws: the 文件 page or one file tab. */
export type StripTabId = RightbarTabId | (string & {});
