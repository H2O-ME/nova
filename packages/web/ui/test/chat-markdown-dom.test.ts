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
import { AssistantMessage, UserMessageRow } from '../src/chat/MessageItem.js';
import { TurnHeader } from '../src/chat/TurnHeader.js';
import { TurnUsagePill, TurnUsageTrigger } from '../src/chat/TurnUsagePill.js';
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
    // The supported language id is the label; the controls carry accessible
    // names instead of visible text (the harness's icon toolbar).
    expect(out).toContain('>ts</span>');
    expect(out).toContain('aria-label="复制"');
    // Highlighted runs ride the css-variables theme's own custom properties.
    expect(out).toContain('--shiki-token-keyword');
  });

  it('names the wrap control and publishes the wrapping state', () => {
    // Wrapped is the resting state; `data-code-wrap` is the hook every
    // owner rule keys on, and `aria-pressed` states it for assistive tech.
    const wrapped = html('```ts\nconst a = 1;\n```');
    expect(wrapped).toContain('data-code-wrap="true"');
    expect(wrapped).toContain('aria-pressed="true"');
    expect(wrapped).toContain('aria-label="取消自动换行"');
    // An unreadable language keeps the toolbar and falls back to its label.
    const unknown = html('```brainfuck\n+++\n```');
    expect(unknown).toContain('data-code-block-banner');
    expect(unknown).toContain('代码块');
  });

  it('keeps an empty fence as the plain pre the reference pipeline produced', () => {
    const out = html('```py\n```');
    expect(out).toContain('language-py');
    expect(out).not.toContain('md-code-block');
  });
});

describe('compact markdown', () => {
  it('publishes the variant and keeps every block shape', () => {
    const compact = (text: string): string =>
      renderToStaticMarkup(createElement(MarkdownText, { text, variant: 'compact' }));
    const out = compact('# h\n\npara **b**\n\n- a\n\n> q');
    expect(out).toContain('data-markdown-variant="compact"');
    expect(out).toContain('<h1');
    expect(out).toContain('<strong>b</strong>');
    expect(out).toContain('<ul');
    expect(out).toContain('<blockquote');
    // The default variant stays bare so the two are distinguishable.
    expect(html('# h')).not.toContain('data-markdown-variant');
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

  it('renders a reasoning row in the step-process vocabulary: paragraph preview, settled label', () => {
    // While streaming the preview is the FIRST LINE OF THE LAST COMPLETED
    // PARAGRAPH — a paragraph still being typed is not a summary. Here the
    // second paragraph has no newline of its own yet, so the first stands.
    const live = renderToStaticMarkup(createElement(ReasoningRow, {
      text: 'first thought\n\nsecond thought\nstill typing',
      running: true,
    }));
    expect(live).toContain('正在分析请求');
    expect(live).toContain('second thought');
    expect(live).not.toContain('still typing');
    expect(live).toContain('data-preview');
    expect(live).toContain('data-streaming');
    expect(live).not.toContain('data-expanded');
    // Settled: the work is named, and the preview is the text's own first line
    // (the harness's `firstLine`); the whole body is one click away.
    const settled = renderToStaticMarkup(createElement(ReasoningRow, {
      text: 'first thought\n\nsecond thought',
      running: false,
    }));
    expect(settled).toContain('已完成分析');
    expect(settled).toContain('first thought');
    expect(settled).not.toContain('data-streaming');
    // The row's title is only the settled label — the reasoning text never
    // stands in as the title (that is the pending chevron's job).
    expect(settled).not.toContain('data-state="running"');
  });

  it('keeps the collapsed preview slot mounted and hides it through the row hook', () => {
    // The harness passes `collapsedContent` UNCONDITIONALLY and lets the sheet
    // hide the separator + summary from `.root:not([data-preview])`. A row
    // without a summary therefore still renders the slot, and the visual
    // hiding is exactly the `data-preview` hook.
    const bare = renderToStaticMarkup(createElement(ReasoningRow, { text: '', running: false }));
    expect(bare).not.toContain('data-preview');
    expect(bare).toContain('data-state="ok"');
    // With a summary the same slot is present and the hook is on.
    const summarised = renderToStaticMarkup(createElement(ReasoningRow, {
      text: 'a **bold** thought',
      running: false,
    }));
    expect(summarised).toContain('data-preview');
    // The preview strips emphasis markers but never renders them as elements:
    // the row's summary is text, and the markdown body (a compact variant of
    // the same source) is what expansion reveals.
    expect(summarised).toContain('a bold thought');
    expect(summarised).not.toContain('**bold**');
  });

  it('renders the turn header settled with duration, running with a collapsible-free row', () => {
    const settled = renderToStaticMarkup(createElement(TurnHeader, {
      label: '用时 5秒',
      collapsible: true,
      open: false,
    }));
    expect(settled).toContain('用时 5秒');
    expect(settled).toContain('aria-expanded="false"');
    const open = renderToStaticMarkup(createElement(TurnHeader, {
      label: '用时 5秒',
      collapsible: true,
      open: true,
    }));
    expect(open).toContain('data-open');
    const running = renderToStaticMarkup(createElement(TurnHeader, { label: '生成中', running: true }));
    expect(running).toContain('data-running');
    expect(running).toContain('disabled');
  });

  it('renders the usage pill with its panel rows and hides it without tokens', () => {
    const stats: RunStats = {
      startedAt: 0,
      durationMs: 5_600,
      firstTokenMs: 900,
      llmMs: 5_600,
      toolMs: 0,
      requests: 1,
      toolCalls: 0,
      retries: 0,
      promptTokens: 24_000,
      completionTokens: 209,
      cachedTokens: 8,
    };
    const pill = renderToStaticMarkup(createElement(TurnUsagePill, { stats, modelName: 'DeepSeek V4 Flash' }));
    expect(pill).toContain('用量 24.2K tok');
    expect(pill).not.toContain('23,992');
    const open = renderToStaticMarkup(createElement(TurnUsageTrigger, { stats, modelName: null, open: true, onToggle: () => {} }));
    expect(open).toContain('本轮用量');
    expect(open).toContain('23,992');
    expect(open).not.toContain('模型');
    const empty = renderToStaticMarkup(createElement(TurnUsageTrigger, { stats: { ...stats, promptTokens: 0, completionTokens: 0, cachedTokens: 0 }, modelName: null, open: false, onToggle: () => {} }));
    expect(empty).toBe('');
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
      empty: 'welcome',
    }));
    expect(out).toContain('data-chat-anchor-key="b1"');
    expect(out).toContain('data-chat-flow-kind="assistant"');
    // A closed process reads as one summary followed by its answer.
    expect(out).toContain('data-turn-process-answer');
    expect(out).not.toContain('welcome');
  });

  it('tightens only a closed process answer, not one inside an expanded group', () => {
    const closed = renderToStaticMarkup(createElement(ChatView, {
      rows: [
        { key: 'b1', kind: 'process', node: 'header' },
        { key: 'b2', kind: 'assistant', node: 'answer' },
      ],
    }));
    expect(closed).toContain('data-turn-process-answer');

    // An expanded turn emits its process rows as group members (the answer stays
    // ungrouped, exactly as `flowRows` builds it): the group body owns the 16px
    // rhythm, so the answer must not carry the collapsed 8px override.
    const expanded = renderToStaticMarkup(createElement(ChatView, {
      rows: [
        { key: 'b1', kind: 'process', node: 'header' },
        { key: 'b2', kind: 'process', node: 'step', group: { id: 'g1', live: false } },
        { key: 'b3', kind: 'assistant', node: 'answer' },
      ],
    }));
    expect(expanded).not.toContain('data-turn-process-answer');
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