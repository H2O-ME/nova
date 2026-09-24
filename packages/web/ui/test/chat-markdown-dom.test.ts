/**
 * The markdown RENDER lane: static markup (no DOM, no browser) over the whole
 * chain — `parse.ts` → `blocks.tsx` → `inline.ts` → `inline-view.tsx`. It
 * asserts the DOM the ported stylesheets and the flow rules hang off, which is
 * exactly what the harness pins with its own DOM fixtures:
 *
 *  - the `.markdown` root and the `.md-table-wide` / `.md-code-block` global
 *    hooks (both are literal class names, so they survive any CSS-module
 *    hashing);
 *  - GFM shapes the sheet styles: `contains-task-list` / `task-list-item`,
 *    `<ol start>`, table alignment styles, `<hr>`, `<del>`, `<br>` + newline;
 *  - the untrusted-output policy visible in the output: a `javascript:` link
 *    renders as text, a non-HTTP image renders as its alt text, and an
 *    external anchor carries `target`/`rel`.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownText } from '../src/chat/markdown/MarkdownText.js';
import { AssistantMessage, MetaRow, UserMessageRow } from '../src/chat/MessageItem.js';
import { ReasoningRow } from '../src/chat/ReasoningRow.js';
import { ChatView } from '../src/chat/ChatView.js';
import type { RunStats } from '../src/types.js';

const html = (text: string, streaming = false): string =>
  renderToStaticMarkup(createElement(MarkdownText, { text, streaming }));

describe('markdown document', () => {
  it('renders a semantic element tree with no HTML-string path', () => {
    const out = html('# t\n\npara **b** and `c`\n\n- a\n- b\n\n> q\n\n---');
    expect(out).toContain('<h1');
    expect(out).toContain('<p');
    expect(out).toContain('<strong>b</strong>');
    expect(out).toContain('<code>c</code>');
    expect(out).toContain('<ul');
    expect(out).toContain('<blockquote');
    expect(out).toContain('<hr');
  });

  it('keeps raw HTML in the source as literal text', () => {
    const out = html('<img src=x onerror=alert(1)>');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<img');
  });

  it('marks a streaming body on the root', () => {
    expect(html('a', true)).toContain('data-streaming');
    expect(html('a', false)).not.toContain('data-streaming');
  });
});

describe('fences', () => {
  it('renders the language banner, the copy control and the stable hook', () => {
    const out = html('```ts\nconst a = 1;\n```');
    expect(out).toContain('md-code-block');
    expect(out).toContain('data-code-block-banner');
    expect(out).toContain('ts</div>');
    expect(out).toContain('复制');
    // Highlighted runs ride the css-variables theme's own custom properties.
    expect(out).toContain('--shiki-token-keyword');
  });

  it('keeps an empty fence as the plain pre the reference pipeline produced', () => {
    const out = html('```py\n```');
    expect(out).toContain('language-py');
    expect(out).not.toContain('md-code-block');
  });
});

describe('tables', () => {
  it('gives a four-column table the wide hook and keyboard reachability', () => {
    const out = html('| a | b | c | d |\n| - | - | - | - |\n| 1 | 2 | 3 | 4 |');
    expect(out).toContain('md-table-wide');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('<th');
  });

  it('lets a narrow table fill the column instead', () => {
    const out = html('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(out).not.toContain('md-table-wide');
  });

  it('carries the column alignment into the cell style', () => {
    expect(html('| a | b |\n| :- | -: |\n| 1 | 2 |')).toContain('text-align:right');
  });
});

describe('lists', () => {
  it('renders task items with a disabled checkbox and the GFM classes', () => {
    const out = html('- [x] done\n- [ ] todo');
    expect(out).toContain('contains-task-list');
    expect(out).toContain('task-list-item');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('disabled');
  });

  it('carries an ordered list start', () => {
    expect(html('3) three')).toContain('start="3"');
  });
});

describe('untrusted output policy', () => {
  it('opens external anchors safely and renders a rejected destination as text', () => {
    const out = html('[a](https://x.dev) [b](javascript:alert(1))');
    expect(out).toContain('href="https://x.dev"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('[b](javascript:alert(1))');
    expect(out).not.toContain('href="javascript:');
  });

  it('falls back to alt text for an image it must not display', () => {
    expect(html('![alt](/local.png)')).toContain('alt</span>');
    expect(html('![alt](https://x.dev/i.png)')).toContain('referrerPolicy="no-referrer"');
  });
});

describe('message rows', () => {
  it('renders the user bubble with its clock-before-icons chrome', () => {
    const out = renderToStaticMarkup(createElement(UserMessageRow, { text: 'hi', time: 0 }));
    expect(out).toContain('hi');
    // The copy control is the only button on a user row without a branch slot.
    expect(out).toContain('aria-label="复制"');
    expect(out).not.toContain('branch');
  });

  it('renders the assistant body full width and marks an interrupted turn', () => {
    const out = renderToStaticMarkup(createElement(AssistantMessage, { text: 'answer', interrupted: true }));
    expect(out).toContain('answer');
    expect(out).toContain('本轮已中断');
  });

  it('renders a reasoning row collapsed to its line, expanded on request', () => {
    const out = renderToStaticMarkup(createElement(ReasoningRow, { text: 'line one\nline two', running: true }));
    expect(out).toContain('思考');
    expect(out).toContain('line two');
    expect(out).not.toContain('data-expanded');
  });

  it('formats the run meta line through format.ts', () => {
    const stats: RunStats = {
      startedAt: 0,
      durationMs: 5_600,
      firstTokenMs: 900,
      llmMs: 5_600,
      toolMs: 0,
      requests: 1,
      toolCalls: 0,
      retries: 0,
      promptTokens: 10,
      completionTokens: 40,
      cachedTokens: 0,
    };
    const out = renderToStaticMarkup(createElement(MetaRow, { stats }));
    expect(out).toContain('用时 5.6s');
    expect(out).toContain('首 token 900ms');
  });
});

describe('chat view', () => {
  it('seats rows with the harness hooks and draws the flow', () => {
    const out = renderToStaticMarkup(createElement(ChatView, {
      rows: [
        { key: 'b1', kind: 'user', node: 'hello' },
        { key: 'b2', kind: 'process', node: 'work' },
        { key: 'b3', kind: 'assistant', node: 'answer' },
        { key: 'b4', kind: 'tool', node: 'call' },
      ],
      status: { label: '生成中' },
      empty: 'welcome',
    }));
    expect(out).toContain('data-chat-anchor-key="b1"');
    expect(out).toContain('data-chat-flow-kind="assistant"');
    // A closed process reads as one summary followed by its answer.
    expect(out).toContain('data-turn-process-answer');
    expect(out).toContain('生成中');
    expect(out).not.toContain('welcome');
  });

  it('offers the load-older row only while older blocks exist', () => {
    const older = renderToStaticMarkup(createElement(ChatView, {
      rows: [{ key: 'b1', kind: 'user', node: 'x' }],
      hiddenOlder: 20,
    }));
    expect(older).toContain('加载更早（还有 20 条）');
    const none = renderToStaticMarkup(createElement(ChatView, { rows: [] }));
    expect(none).not.toContain('加载更早');
  });
});