/**
 * The `@` menu's breadcrumb header, as a pure function — the harness
 * `ui-reference`'s `crumbsFor`, over our plain textarea grammar.
 *
 * Only a DRILL produces one: a path the user typed carries its own context in
 * the draft, while a drill replaced the text they were reading with a deeper
 * one and owes them the way back. Each crumb is the directory a click drills
 * to (the draft rewrite `referenceDraft` already understands), so the header
 * is both a map and the navigation.
 */
import { REFERENCE_ROOT_CRUMB } from './composer-text.js';

/** One step of a drilled listing's trail. */
export interface ReferenceCrumb {
  /** The segment's own name; the root step is the workspace itself. */
  label: string;
  /**
   * The directory this step drills to, workspace-relative WITHOUT a trailing
   * slash — `''` is the workspace root.
   */
  path: string;
  /** The step the list is already showing: a label, not an action. */
  current: boolean;
}

/**
 * The trail of a drilled directory listing, root first, current last.
 * @param query - the live `@` query (path text following `@` or `@"`).
 * @param drilled - this listing was reached by a drill pick, not by typing.
 * @returns the crumbs, or null when this listing needs no header — an
 *   undrilled query, or a bare directory with no `/` to climb back from.
 */
export function referenceCrumbs(query: string, drilled: boolean): readonly ReferenceCrumb[] | null {
  if (!drilled) return null;
  const slash = query.lastIndexOf('/');
  if (slash < 0) return null;
  const segments = query.slice(0, slash).split('/').filter((segment) => segment !== '');
  const crumbs: ReferenceCrumb[] = [{ label: REFERENCE_ROOT_CRUMB, path: '', current: segments.length === 0 }];
  for (const [index, segment] of segments.entries()) {
    crumbs.push({
      label: segment,
      path: segments.slice(0, index + 1).join('/'),
      current: index === segments.length - 1,
    });
  }
  return crumbs;
}
