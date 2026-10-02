/**
 * The right panel's path algebra: how a host-spelled absolute path becomes the
 * short spelling a reader and the composer both use, and how it splits into the
 * directory and leaf a rename needs.
 *
 * Two consumers, one rule. The tree's rows carry absolute paths (the host built
 * them — the browser never joins segments), while
 *   - the composer's `@` references are WORKSPACE-RELATIVE (the system prompt
 *     tells the model to hand `@path` to `read_file` unchanged), and
 *   - git reports repo-relative paths with forward slashes.
 *
 * So both spellings come out of one place, and a path outside the workspace
 * keeps its absolute form rather than being mangled into a fake relative one.
 */

/**
 * Whether path comparisons should fold case.
 *
 * Windows does and POSIX does not, and the answer has to come from something
 * that EXISTS in a browser: this module is bundled for the page, where `process`
 * is not defined — reading `process.platform` here threw
 * `ReferenceError: process is not defined` on the first render of the files
 * panel, and an uncaught render error blanks the whole app (there was no error
 * boundary yet), which is exactly what "侧边栏完全不可用" was. The user agent is the
 * platform the HOST also runs on (the host serves this page from the same
 * machine), so it is the honest browser-side answer; the Node test lane, which
 * has no user agent, falls back to the runtime's own platform.
 * @returns true when `a.ts` and `A.ts` are the same path here.
 */
export function foldsCase(): boolean {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (agent !== '') return /Windows/iu.test(agent);
  return typeof process !== 'undefined' && process.platform === 'win32';
}

/**
 * The key a path is compared under: itself, or its case-folded self on Windows.
 * @param path - a normalized path.
 * @returns the comparison key.
 */
export function pathKey(path: string): string {
  return foldsCase() ? path.toLowerCase() : path;
}

/**
 * Normalize a path for comparison: backslashes to forward slashes, trailing
 * slashes dropped. Case is preserved.
 * @param path - the path as the host (or git) spelled it.
 * @returns the normalized spelling.
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/gu, '/').replace(/\/+$/u, '');
}

/**
 * The path relative to `root`, forward-slashed. A path outside the root (or a
 * root that is empty) comes back normalized-but-absolute: the caller gets a
 * usable path either way, and nothing pretends a sibling is a child.
 * @param root - the workspace root as the host spelled it.
 * @param path - the absolute path to shorten.
 * @returns the relative spelling when the path is inside the root, its
 *   normalized self otherwise.
 */
export function relativeTo(root: string, path: string): string {
  const base = normalizePath(root);
  const full = normalizePath(path);
  if (base.length === 0) return full;
  // Windows folds case (a drive letter or a folder may differ); POSIX does not.
  const baseKey = pathKey(base);
  const fullKey = baseKey === base ? full : pathKey(full);
  if (fullKey === baseKey) return '';
  if (!fullKey.startsWith(`${baseKey}/`)) return full;
  return full.slice(base.length + 1);
}

/**
 * The composer token for one path: `@rel`, or `@"rel with spaces"` when the
 * spelling would otherwise break at the first space. The quoting is the
 * composer's own rule (`mention-tokens.ts` reads both forms back), so a file
 * this writes is one the reader could have typed.
 * @param root - the workspace root.
 * @param path - the file or directory to reference.
 * @returns the token, ready to be appended to a draft.
 */
export function referenceToken(root: string, path: string): string {
  const rel = relativeTo(root, path);
  return /[\s"]/u.test(rel) ? `@"${rel}"` : `@${rel}`;
}

/**
 * The parent directory of a path, as the host spelled it (either separator; the
 * browser never rewrites a separator, it only splits on one).
 * @param path - an absolute path.
 * @returns the parent's spelling, or '' for a bare name.
 */
export function parentDir(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at === -1 ? '' : path.slice(0, at);
}

/**
 * The last segment of a path: what a rename box edits and what a rename frame
 * keeps as the new leaf.
 * @param path - an absolute path or a typed name.
 * @returns the segment after the last separator.
 */
export function baseName(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at === -1 ? path : path.slice(at + 1);
}
