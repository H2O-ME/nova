/**
 * Correlation ids for `plugin_request` frames, minted from ONE module-level
 * counter that never resets.
 *
 * A per-mount counter was the original shape, and its own comment claimed the
 * reducer matched answers "by plugin AND id" — it never did: answers were keyed
 * by plugin alone, so a slow reply to a PREVIOUS mount's request (same id — the
 * counter restarted at every remount) landed on the fresh page as if it were
 * the fresh page's answer. The fix has two halves and both live in this
 * contract:
 *
 *  - the id never repeats (`nextPluginRequestId` is monotonic for the life of
 *    the page), so a previous mount's ids are always SMALLER than the current
 *    mount's;
 *  - the reducer drops an answer older than the newest one already stored for
 *    that plugin (`state.ts`'s `plugin_answer` case), which is what actually
 *    enforces the isolation.
 */

let lastId = 0;

/**
 * The next correlation id. Monotonic across every caller for the life of the
 * page — which is what makes "older than the stored answer" a sound staleness
 * test in the reducer.
 * @returns an id strictly greater than every id handed out before.
 */
export function nextPluginRequestId(): number {
  lastId += 1;
  return lastId;
}
