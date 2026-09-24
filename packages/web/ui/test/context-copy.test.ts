import { describe, expect, it } from 'vitest';
import { CONTEXT_ROW_TITLE, contextLabel } from '../src/chat/context-copy.js';

/**
 * The context rows name their producers from the fragment tag. The mapping is
 * pure, so it is pinned here rather than through a rendered row — and the
 * fallback matters: `core` splits any `<tag>…</tag>` run, so a fragment from a
 * future build must still name something instead of rendering an empty label.
 */
describe('contextLabel', () => {
  it('names the four sections the kernel writes today', () => {
    expect(contextLabel('environment')).toBe('环境信息');
    expect(contextLabel('user_instructions')).toBe('用户指令');
    expect(contextLabel('project_docs')).toBe('项目文档');
    expect(contextLabel('available_skills')).toBe('技能索引');
  });

  it('falls back to the tag itself for a section this build does not know', () => {
    expect(contextLabel('memory')).toBe('memory');
  });

  it('keeps one title for every section row (the disclosure chrome is shared)', () => {
    expect(CONTEXT_ROW_TITLE).toBe('上下文注入');
  });
});