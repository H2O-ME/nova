/**
 * What the context-injection rows call their producers. Pure, so the mapping
 * is pinned without a DOM; unknown tags fall through to the tag itself, which
 * is the honest answer for a section this build has never seen (`core` parses
 * any `<tag>…</tag>` run, so a future fragment still renders).
 */

/** The disclosure title every section row carries. */
export const CONTEXT_ROW_TITLE = '上下文注入';

/** The section tags `buildContextFragment` writes today. */
const LABELS: Record<string, string> = {
  environment: '环境信息',
  user_instructions: '用户指令',
  project_docs: '项目文档',
  available_skills: '技能索引',
};

/**
 * The producer name for one section tag.
 *
 * `Object.hasOwn` and not a bare index: the table is an object literal, so a
 * tag like `constructor` would resolve to an inherited member and render a
 * function into the row. The tag reaches here straight off the wire.
 * @param tag - the fragment's tag.
 * @returns the row's label; the tag itself when this build does not know it.
 */
export function contextLabel(tag: string): string {
  return Object.hasOwn(LABELS, tag) ? LABELS[tag] as string : tag;
}