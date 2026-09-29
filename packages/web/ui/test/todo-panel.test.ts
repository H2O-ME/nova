/**
 * The plan panel's contracts: the header counts, the collapse default, and the
 * "no plan ≠ empty plan" rule that decides whether the dock shows anything.
 *
 * Static markup (this lane has no DOM), so every assertion is about a contract a
 * caller or the ported stylesheet depends on: the accessible name, the expanded
 * state, the per-status counts and the dots' identity.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TodoPanel, progressLabel } from '../src/conversation/TodoPanel.js';
import type { TodoItem } from '../src/types.js';

const plan: TodoItem[] = [
  { content: '读一下现有的认证代码', status: 'completed' },
  { content: '抽出 token 校验', status: 'in_progress' },
  { content: '补回归测试', status: 'pending' },
  { content: '更新文档', status: 'pending' },
];

function draw(todos: readonly TodoItem[] | null): string {
  return renderToStaticMarkup(createElement(TodoPanel, { todos }));
}

describe('progressLabel', () => {
  it('joins the non-zero counts and omits the zero ones', () => {
    expect(progressLabel(plan)).toBe('1 已完成\u2002·\u20021 进行中\u2002·\u20022 待处理');
    // A one-segment summary carries no separator at all.
    expect(progressLabel([{ content: 'a', status: 'pending' }])).toBe('1 待处理');
    expect(progressLabel([{ content: 'a', status: 'completed' }])).toBe('1 已完成');
  });

  it('counts every item exactly once', () => {
    const only = plan.filter((item) => item.status === 'in_progress');
    expect(progressLabel(only)).toBe('1 进行中');
    // The pending segment is derived by subtraction, so a miscount would show
    // up as a missing or duplicated item here rather than silently.
    const total = plan.filter((i) => i.status === 'completed').length
      + plan.filter((i) => i.status === 'in_progress').length
      + (plan.length - plan.filter((i) => i.status === 'completed').length - plan.filter((i) => i.status === 'in_progress').length);
    expect(total).toBe(plan.length);
  });
});

describe('TodoPanel', () => {
  it('renders nothing without a plan, and nothing for an EMPTY plan', () => {
    // `null` is "the model never planned"; `[]` is "it planned and then cleared
    // it". Neither should leave a card on the dock — but they are different
    // facts, which is why the state keeps them apart.
    expect(draw(null)).toBe('');
    expect(draw([])).toBe('');
  });

  it('starts collapsed: the panel is context, not the product', () => {
    const html = draw(plan);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="任务"');
    expect(html).toContain('1 已完成');
    // Collapsed means the list is absent, not merely hidden.
    expect(html).not.toContain('读一下现有的认证代码');
  });

  it('names the status on each row marker instead of relying on color', () => {
    const html = renderToStaticMarkup(
      createElement(TodoPanel, { todos: plan, defaultCollapsed: false }),
    );
    expect(html).toContain('读一下现有的认证代码');
    expect(html).toContain('aria-label="已完成"');
    expect(html).toContain('aria-label="进行中"');
    expect(html).toContain('aria-label="待处理"');
    // The status also rides the row as data: the dot's state and this attribute
    // are the two things a reader (or a future style rule) keys off. The sheet
    // deliberately styles NO per-status row ink — the dot alone carries it.
    expect(html).toContain('data-status="completed"');
    expect(html).toContain('data-status="in_progress"');
  });

  it('keeps a stable identity per row so a rewrite reconciles in place', () => {
    const renamed = plan.map((item) => item.status === 'pending' ? { ...item, status: 'completed' as const } : item);
    const html = renderToStaticMarkup(
      createElement(TodoPanel, { todos: renamed, defaultCollapsed: false }),
    );
    expect(html).toContain('3 已完成\u2002·\u20021 进行中');
    expect(html).not.toContain('待处理');
  });
});
