/**
 * The tree's pick: which rows are selected, and what one click means.
 *
 * Ported from the reference's multi-select rules (`dsh-better-sidebar`
 * `FileTree.tsx`, frozen in its 2026-09-27 files/changes UX contract): a plain
 * click ACTS on the row and clears the pick, Ctrl/Cmd toggles one row and
 * re-anchors, and Shift ranges from the anchor over the rows **currently on
 * screen** — depth-first, expansion decides — which is the gesture every file
 * manager has and the one that is easy to get subtly wrong.
 *
 * Pure, and separate from the panel, because the range rule is exactly the part
 * worth asserting without a DOM: which row is the anchor, what a collapsed
 * branch does to the range, and what happens when the anchor has scrolled out
 * of the tree entirely.
 */

/** The tree's pick, in the order rows were added to it. */
export interface TreeSelection {
  /** Picked absolute paths. */
  paths: readonly string[];
  /** The row a Shift-click ranges from; null when nothing has been clicked yet. */
  anchor: string | null;
}

export const emptySelection: TreeSelection = { paths: [], anchor: null };

/** The modifiers a click carried (the panel maps them from the event). */
export interface ClickModifiers {
  ctrl: boolean;
  shift: boolean;
}

/**
 * What one row click means.
 *
 * A plain click clears the pick rather than selecting the row: the click already
 * DID something (opened the file, expanded the directory), and a batch bar
 * appearing after every ordinary click would be noise. The anchor is set anyway,
 * so the very next Shift-click ranges from the row the reader just used.
 * @param selection - the pick before the click.
 * @param rows - the selectable paths in display order (visible entry rows only).
 * @param path - the clicked row.
 * @param mods - the click's modifiers.
 * @returns the pick after the click.
 */
export function clickSelection(
  selection: TreeSelection,
  rows: readonly string[],
  path: string,
  mods: ClickModifiers,
): TreeSelection {
  if (mods.shift && selection.anchor !== null) {
    const from = rows.indexOf(selection.anchor);
    const to = rows.indexOf(path);
    // A range needs both ends on screen; when the anchor is gone (its directory
    // collapsed, the file deleted) the honest reading is "start a new pick here"
    // rather than a range over rows the reader cannot see.
    if (from === -1 || to === -1) return { paths: [path], anchor: path };
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    return { paths: rows.slice(start, end + 1), anchor: selection.anchor };
  }
  if (mods.ctrl) {
    const paths = selection.paths.includes(path)
      ? selection.paths.filter((item) => item !== path)
      : [...selection.paths, path];
    return { paths, anchor: path };
  }
  return { paths: [], anchor: path };
}

/** Whether a row is drawn as picked. */
export function isPicked(selection: TreeSelection, path: string): boolean {
  return selection.paths.includes(path);
}

/**
 * Drop picked paths that are no longer on screen — a deleted file, a collapsed
 * branch. The batch bar's count must describe rows the reader can still act on.
 * @param selection - the pick before the rows changed.
 * @param rows - the selectable paths now on screen.
 * @returns the same object when nothing was dropped (referential stability).
 */
export function pruneSelection(selection: TreeSelection, rows: readonly string[]): TreeSelection {
  const visible = new Set(rows);
  const paths = selection.paths.filter((path) => visible.has(path));
  if (paths.length === selection.paths.length) return selection;
  const anchor = selection.anchor !== null && visible.has(selection.anchor) ? selection.anchor : null;
  return { paths, anchor };
}

/**
 * The clipboard text for a pick: one absolute path per line, in pick order
 * (the reference's own rule — a shell script can read it, a chat message can
 * paste it).
 */
export function selectionText(selection: TreeSelection): string {
  return selection.paths.join('\n');
}
