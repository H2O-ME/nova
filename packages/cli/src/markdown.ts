import type { Paint } from './lines.js';

/** 渲染器只借色彩的三个开态（M11：tui-view 已退役，Palette 名沿用于本地闭包）。 */
type Palette = Pick<Paint, 'cyan' | 'dim' | 'bold'>;

/**
 * Minimal markdown-to-ANSI rendering for assistant replies: bold, inline
 * code, headings, bullets and fenced code blocks. Everything else passes
 * through untouched — the goal is removing raw markdown symbols from the
 * screen, not full document rendering.
 */

/**
 * Shared per-line renderer. `state.inFence` carries across lines; a
 * fence-marker line produces no output (undefined). `commit=false`
 * re-renders a still-unfinished trailing line without mutating fence state —
 * the line is re-processed for real once its newline arrives.
 */
function renderLine(raw: string, state: { inFence: boolean }, p: Palette, commit = true): string | undefined {
  const line = raw.replace(/\s+$/, '');
  if (/^\s*```/.test(line)) {
    if (commit) state.inFence = !state.inFence;
    return undefined;
  }
  if (state.inFence) return p.dim(line);
  const heading = line.match(/^#{1,6}\s+(.*)$/);
  if (heading !== null) return p.bold(p.cyan(heading[1] ?? ''));
  const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
  if (bullet !== null) {
    // 列表项统一缩进 2 列再挂圆点：与正文同列时层级读不出来。wrapBlock 把
    // 这段前导空格算进悬挂缩进，换行续行对齐到条目文本列。
    return `${bullet[1]}  · ${renderInline(bullet[2] ?? '', p)}`;
  }
  return renderInline(line, p);
}

function renderInline(text: string, p: Palette): string {
  // Code spans are extracted to placeholders first so the bold pass can never
  // match across a code span's ANSI-wrapped content — `` `a**b` **c** ``
  // previously bolded straight through the code span and shredded its color.
  const codes: string[] = [];
  const withPlaceholders = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(p.cyan(code));
    // \u0000 never appears in model text; digits after it cannot collide
    // because the closing sentinel is required too.
    return `\u0000${codes.length - 1}\u0000`;
  });
  const bolded = withPlaceholders.replace(/\*\*([^*]+)\*\*/g, (_, bold: string) => p.bold(bold));
  // oxlint-disable-next-line no-control-regex -- \u0000 is the placeholder sentinel we just inserted
  return bolded.replace(/\u0000(\d+)\u0000/g, (_, idx: string) => codes[Number(idx)] ?? '');
}

export function renderMarkdownLite(text: string, p: Palette): string[] {
  const state = { inFence: false };
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = renderLine(raw, state, p);
    if (line !== undefined) out.push(line);
  }
  return out;
}

/**
 * Incremental streaming renderer: complete lines are rendered once and
 * cached; only the trailing (still-unfinished) line is re-rendered per push.
 * Replaces the old whole-text re-render on every delta, which made long
 * replies progressively laggy.
 */
export interface MarkdownRenderer {
  push(text: string): string[];
}

export function createMarkdownRenderer(p: Palette): MarkdownRenderer {
  const state = { inFence: false };
  const done: string[] = [];
  let pending = '';
  return {
    push(text: string): string[] {
      pending += text;
      let newlineIdx = pending.indexOf('\n');
      while (newlineIdx >= 0) {
        const line = renderLine(pending.slice(0, newlineIdx), state, p);
        if (line !== undefined) done.push(line);
        pending = pending.slice(newlineIdx + 1);
        newlineIdx = pending.indexOf('\n');
      }
      if (pending.length === 0) return [...done];
      const tail = renderLine(pending, state, p, false);
      return tail !== undefined ? [...done, tail] : [...done];
    },
  };
}
