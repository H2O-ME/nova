import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from '../src/system-prompt.js';
import { createMarkdownRenderer, renderMarkdownLite } from '../src/markdown.js';
import { buildWindowsToastScript } from '../src/notify.js';
import {
  allocateCells,
  approvalChip,
  contextBar,
  contextGaugeForms,
  contextLegend,
  cursorAfterVerticalMove,
  fitTail,
  humanTokens,
  isReadOnlyTool,
  layoutComposer,
  modelTail,
  padBetween,
  palette,
  planContextSegments,
  plainPalette,
  segmentBar,
  sparkline,
  statusLine,
  toolArgSummary,
  toolDoneLine,
  toolGroupLine,
  toolStartLine,
  wrapComposer,
  type ContextSegment,
  type Palette,
} from '../src/ui.js';

describe('system prompt', () => {
  it('forbids tool use on greetings and unsolicited work', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/Do NOT call any tools/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/only when the user asks for it/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/do not invent follow-up work/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/Mirror the user's language/);
  });

  it('stays byte-stable: no environment or user instructions baked in', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(prompt).not.toContain('platform=');
    expect(prompt).not.toContain('## User instructions');
    // the fragment contract is documented in the prompt itself
    expect(prompt).toContain('<environment>');
    expect(prompt).toContain('<available_skills>');
  });
});

const p: Palette = plainPalette;

describe('ui helpers', () => {
  it('humanizes token counts without noisy decimals', () => {
    expect(humanTokens(22)).toBe('22');
    expect(humanTokens(1000)).toBe('1k');
    expect(humanTokens(1100)).toBe('1.1k');
    expect(humanTokens(58200)).toBe('58k');
    expect(humanTokens(200000)).toBe('200k');
    expect(humanTokens(1050000)).toBe('1.05M'); // was '1050.0k'
    expect(humanTokens(1048576)).toBe('1.05M');
    expect(humanTokens(2000000)).toBe('2M');
  });

  it('summarizes tool args by key field instead of raw JSON', () => {
    expect(toolArgSummary('bash', '{"command":"echo hi"}')).toBe('echo hi');
    expect(toolArgSummary('read_file', '{"path":"src/a.ts"}')).toBe('src/a.ts');
    expect(toolArgSummary('jobs', '{"action":"stop","id":"bash-1"}')).toBe('stop bash-1');
    expect(toolArgSummary('todo_write', '{"todos":[{"content":"a","status":"pending"}]}')).toBe('1 项待办');
    expect(toolArgSummary('t', 'not json')).toBe('not json');
    expect(toolArgSummary('bash', `{"command":"${'x'.repeat(200)}"}`)).toContain('…');
  });

  it('formats the running tool line as a one-line summary', () => {
    expect(toolStartLine(p, 'bash', '{"command":"echo hi"}')).toBe('    • 执行命令 echo hi');
    expect(toolStartLine(p, 'read_file', '{"path":"a.txt"}')).toContain('读取文件');
    expect(toolStartLine(p, 'read_file', '{"path":"a.txt"}')).not.toContain('{');
    expect(toolStartLine(p, 'bash', '{"command":"echo hi"}', '⠙')).toContain('⠙');
  });

  it('classifies read-only tools and renders the exploration group line', () => {
    expect(isReadOnlyTool('read_file')).toBe(true);
    expect(isReadOnlyTool('list_dir')).toBe(true);
    expect(isReadOnlyTool('bash')).toBe(false);

    const group = toolGroupLine(p, ['a.ts', 'b.ts', 'c.ts'], 500);
    expect(group).toContain('✓');
    expect(group).toContain('查看');
    expect(group).toContain('a.ts, b.ts, c.ts');
    expect(group).toContain('3 次');
    expect(group).toContain('0.5s');

    const long = toolGroupLine(p, ['x'.repeat(100), 'y.ts'], 100);
    expect(long).toContain('…');
  });

  it('collapses successful tool results to one line', () => {
    const multi = toolDoneLine(p, 'read_file', '{"path":"a.txt"}', 'line1\nline2\nline3\nline4', 420);
    expect(multi).toHaveLength(1);
    expect(multi[0]).toContain('✓');
    expect(multi[0]).toContain('读取文件');
    expect(multi[0]).toContain('a.txt');
    expect(multi[0]).toContain('4 行');
    expect(multi[0]).toContain('0.4s');

    const single = toolDoneLine(p, 'write_file', '{"path":"a.txt"}', 'wrote 5 bytes', 100);
    expect(single).toHaveLength(1);
    expect(single[0]).toContain('wrote 5 bytes');

    const empty = toolDoneLine(p, 'bash', '{"command":"true"}', 'exit: 0', 50);
    expect(empty).toHaveLength(1);
    expect(empty[0]).toContain('✓');
  });

  it('expands failed tool results with the first error line', () => {
    const failed = toolDoneLine(p, 'bash', '{"command":"pnpm test"}', 'exit: 1\nboom happened', 3200);
    expect(failed).toHaveLength(2);
    expect(failed[0]).toContain('✗');
    expect(failed[0]).toContain('pnpm test');
    expect(failed[1]).toContain('boom happened');

    const errored = toolDoneLine(p, 'read_file', '{"path":"x"}', 'Error: file not found', 10);
    expect(errored[0]).toContain('✗');
  });

  it('clips by display columns: CJK paths keep the basename, commands cut at tokens', () => {
    const path = 'D:\\下载\\com.highschool.learningbox_1.26.0_解压\\manifest.json';
    const clipped = toolArgSummary('read_file', JSON.stringify({ path }), 30);
    expect(styledWidth(clipped)).toBeLessThanOrEqual(30);
    expect(clipped).toContain('manifest.json'); // tail survives
    expect(clipped.startsWith('…')).toBe(true);
    // Commands never split a token in half — the cut lands on whitespace.
    const cmd = 'cd "D:/下载/app" && ls -R pages/game | tail -20';
    const cut = toolArgSummary('bash', JSON.stringify({ command: cmd }), 24);
    expect(styledWidth(cut)).toBeLessThanOrEqual(24);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).toBe('cd "D:/下载/app" && …');
  });

  it('keeps the whole tool line on one row when given a terminal budget', () => {
    const cols = 80;
    const longPath = 'D:\\下载\\com.highschool.learningbox_1.26.0_解压\\manifest.json';
    const done = toolDoneLine(p, 'read_file', JSON.stringify({ path: longPath }), 'a\nb\nc', 1700, cols)[0]!;
    expect(styledWidth(done)).toBeLessThanOrEqual(cols - 1);
    expect(done.endsWith('1.7s')).toBe(true); // duration never orphans onto its own row
    const start = toolStartLine(p, 'bash', JSON.stringify({ command: `cd ${longPath} && ls -R` }), '⠙', cols);
    expect(styledWidth(start)).toBeLessThanOrEqual(cols - 1);
  });

  it('collapses the shared directory in exploration group lines', () => {
    const dir = 'D:\\下载\\com.highschool.learningbox_1.26.0_解压';
    const entries = [`${dir}\\manifest.json`, `${dir}\\common\\bf1.py`, `${dir}\\pages\\buy\\buy.js`];
    const line = toolGroupLine(p, entries, 1700, 80);
    expect(styledWidth(line)).toBeLessThanOrEqual(79);
    expect(line).toContain('3 次');
    expect(line.endsWith('1.7s')).toBe(true);
    // 公共前缀只出现一次（收窄保尾段），名字以相对尾段呈现。
    expect(line.match(/1\.26\.0_解压/g)).toHaveLength(1);
    expect(line).toContain('bf1.py');
    // 足够宽的终端：不折叠，原样拼接全路径。
    const wide = toolGroupLine(p, entries, 1700, 220);
    expect(wide).toContain(`${dir}\\manifest.json, ${dir}\\common\\bf1.py`);
  });

  it('formats the status line with cache hit and stop word', () => {
    const line = statusLine(
      p,
      'complete',
      { turns: 2, promptTokens: 2906, completionTokens: 132, cachedTokens: 1536 },
      4200,
    );
    expect(line).toContain('✓ 完成');
    expect(line).toContain('2 轮');
    expect(line).toContain('↑2.9k ↓132 tok');
    expect(line).toContain('缓存 53%');
    expect(line).toContain('4.2s');

    const aborted = statusLine(p, 'aborted', { turns: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0 }, 100);
    expect(aborted).toContain('■ 已中断');
    expect(aborted).toContain('缓存 0%');
  });

  it('renders the context pressure bar with clamping', () => {
    expect(contextBar(0.5, 8)).toBe('████░░░░');
    expect(contextBar(0, 8)).toBe('░░░░░░░░');
    expect(contextBar(1.4, 8)).toBe('████████');
  });
});

describe('allocateCells (largest remainder)', () => {
  it('always fills exactly the requested cells', () => {
    const cells = allocateCells([50, 30, 20], 10);
    expect(cells.reduce((a, b) => a + b, 0)).toBe(10);
    expect(cells).toEqual([5, 3, 2]);
  });
  it('gives rounding leftovers to the largest fractions', () => {
    // each exact share = 3.33 cells → one extra cell to the first (tie by index)
    expect(allocateCells([1, 1, 1], 10)).toEqual([4, 3, 3]);
  });
  it('zero weights get nothing and all-zero degenerates gracefully', () => {
    expect(allocateCells([0, 10], 5)).toEqual([0, 5]);
    expect(allocateCells([0, 0], 5)).toEqual([0, 0]);
  });
  it('survives garbage input', () => {
    expect(allocateCells([NaN, -5, 10], 4)).toEqual([0, 0, 4]);
    expect(allocateCells([1, 2], 0)).toEqual([0, 0]);
  });
});

describe('planContextSegments', () => {
  const segs = [
    { label: '系统', tokens: 1000, color: 'cyan' as const },
    { label: '历史', tokens: 3000, color: 'yellow' as const },
  ];
  it('reserves the unused cells as free space', () => {
    const plan = planContextSegments(segs, 10_000, 10);
    expect(plan.counts).toEqual([1, 3]);
    expect(plan.freeCells).toBe(6);
    expect(plan.ratio).toBeCloseTo(0.4);
    expect(plan.over).toBe(false);
  });
  it('over-budget paints the full bar and flags overflow', () => {
    const plan = planContextSegments(segs, 2000, 10);
    expect(plan.over).toBe(true);
    expect(plan.counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(plan.freeCells).toBe(0);
  });
  it('keeps fill proportional to real usage (no minimum-cell bump)', () => {
    // 1.2k 在 1M 窗口里按真实比例是 0 格——借空闲格画一格会把"已用"虚高
    // 成两成满，条与旁边的 0% 打架。如实画空，比例交给数字。
    const tiny = [
      { label: '系统', tokens: 1000, color: 'cyan' as const },
      { label: '工具', tokens: 100, color: 'green' as const },
    ];
    const plan = planContextSegments(tiny, 1_000_000, 10);
    expect(plan.counts).toEqual([0, 0]);
    expect(plan.freeCells).toBe(10);
    expect(plan.ratio).toBeCloseTo(0.0011);
  });
  it('splits the colored cells by true token share once usage is visible', () => {
    // used 4000 / cap 5000：系统 1000→2 格、历史 3000→6 格、空闲 1000→2 格。
    const segs = [
      { label: '系统', tokens: 1000, color: 'cyan' as const },
      { label: '历史', tokens: 3000, color: 'yellow' as const },
    ];
    const plan = planContextSegments(segs, 5000, 10);
    expect(plan.counts).toEqual([2, 6]);
    expect(plan.freeCells).toBe(2);
    const zero = [
      { label: '系统', tokens: 1000, color: 'cyan' as const },
      { label: '工具', tokens: 0, color: 'green' as const },
    ];
    expect(planContextSegments(zero, 1_000_000, 10).counts).toEqual([0, 0]);
  });
});

describe('segmentBar + legend rendering', () => {
  const segs = [
    { label: '系统', tokens: 1000, color: 'cyan' as const },
    { label: '历史', tokens: 3000, color: 'yellow' as const },
  ];
  it('renders one colored block per segment plus dim free cells', () => {
    const bar = segmentBar(plainPalette, segs, [2, 5], 3, false);
    expect(bar).toBe('███████░░░');
  });
  it('marks the last (history) segment red on overflow', () => {
    const colored = segmentBar({ ...palette, red: (s) => `R(${s})` } as Palette, segs, [2, 5], 0, true);
    expect(colored).toContain('R(█████)');
  });
  it('contextLegend humanizes each segment', () => {
    expect(contextLegend(plainPalette, segs)).toBe('系统 1k · 历史 3k');
  });
  it('contextLegend paints each label with its segment color', () => {
    const colored = contextLegend(palette, segs);
    expect(colored).toContain('\x1b[36m系统\x1b[0m'); // cyan
    expect(colored).toContain('\x1b[33m历史\x1b[0m'); // yellow
  });
});

describe('approvalChip tiering', () => {
  it('T0 keeps the 审批 prefix; T1 drops it; T2 is a single risk char', () => {
    expect(approvalChip(plainPalette, 'auto-edit', 0)).toBe('审批 自动编辑');
    expect(approvalChip(plainPalette, 'auto-edit', 1)).toBe('自动编辑');
    expect(approvalChip(plainPalette, 'auto-edit', 2)).toBe('编');
    expect(approvalChip(plainPalette, 'read-only', 2)).toBe('读');
    expect(approvalChip(plainPalette, 'full', 2)).toBe('全');
  });
  it('colors by risk (green/yellow/red) once the prefix is gone', () => {
    expect(approvalChip(palette, 'read-only', 1)).toContain('\x1b[32m'); // green
    expect(approvalChip(palette, 'auto-edit', 1)).toContain('\x1b[33m'); // yellow
    expect(approvalChip(palette, 'full', 1)).toContain('\x1b[31m'); // red
  });
  it('unknown modes pass their label through', () => {
    expect(approvalChip(plainPalette, 'custom', 0)).toBe('审批 custom');
    expect(approvalChip(plainPalette, 'custom', 2)).toBe('custom');
  });
});

describe('modelTail', () => {
  it('drops the provider prefix, keeps a bare name intact', () => {
    expect(modelTail('anthropic/claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
    expect(modelTail('deepseek-chat')).toBe('deepseek-chat');
    expect(modelTail('a/b/c')).toBe('c');
  });
});

describe('contextGaugeForms tiering', () => {
  const segs: ContextSegment[] = [
    { label: '提示词', tokens: 1000, color: 'cyan' },
    { label: '历史', tokens: 3000, color: 'yellow' },
  ];
  const p = plainPalette;

  it('returns three stable forms; T0 shows the 压缩 tag, T2 drops label + absolute numbers', () => {
    const [t0, t1, t2] = contextGaugeForms(p, { segments: segs, used: 4000, capacity: 10000, compact: 5000 }, 120);
    expect(t0).toContain('上下文');
    expect(t0).toContain('4k/10k');
    expect(t0).toContain('40%');
    expect(t0).toContain('压缩 80%'); // used/compact = 0.8
    expect(t1).toContain('压缩 80%'); // ≥0.5 keeps the warning
    expect(t2).not.toContain('上下文');
    expect(t2).not.toContain('4k/10k');
    expect(t2).toContain('40%');
    expect(t2).toContain('压缩 80%'); // ≥0.7 (imminent) survives even the minimal tier
  });

  it('hides a low 压缩% at T1/T2 but keeps absolute numbers through T1', () => {
    const [t0, t1, t2] = contextGaugeForms(p, { segments: segs, used: 4000, capacity: 10000, compact: 20000 }, 120);
    expect(t0).toContain('压缩 20%');
    expect(t1).not.toContain('压缩');
    expect(t1).toContain('4k/10k');
    expect(t2).not.toContain('压缩');
    expect(t2).not.toContain('4k/10k');
  });

  it('right-pads the percentage so a digit jump cannot shift the divider', () => {
    const bigSegs: ContextSegment[] = [
      { label: '提示词', tokens: 10000, color: 'cyan' },
      { label: '历史', tokens: 30000, color: 'yellow' },
    ];
    const low = contextGaugeForms(p, { segments: segs, used: 4000, capacity: 100000, compact: undefined }, 120);
    const mid = contextGaugeForms(p, { segments: bigSegs, used: 40000, capacity: 100000, compact: undefined }, 120);
    expect(low[2]).toContain('  4%'); // single-digit % is right-padded to 2
    expect(mid[2]).toContain(' 40%');
  });

  it('window-unknown renders a numeric head on every tier (no bar to lean on)', () => {
    const forms = contextGaugeForms(p, { segments: segs, used: 4000, capacity: undefined, compact: 5000 }, 120);
    for (const line of forms) {
      expect(line).toContain('窗口未知');
      expect(line).not.toContain('░'); // no bar cells when capacity is unknown
    }
  });

  it('overflow turns the trailing segment red and the pct red', () => {
    const forms = contextGaugeForms(
      palette,
      { segments: [{ label: '历史', tokens: 12000, color: 'yellow' }], used: 12000, capacity: 10000, compact: undefined },
      160,
    );
    expect(forms[0]).toContain('\x1b[31m'); // red pct / red last segment on over
  });
});

describe('sparkline + right-edge layout', () => {
  it('normalizes samples to the ramp and floors zeros', () => {
    expect(sparkline([0, 0])).toBe('▁▁');
    expect(sparkline([10, 20])).toBe('▅█'); // 10/20×7=3.5 → round 4
    expect(sparkline([5, 10, 1])).toBe('▅█▂');
  });
  it('pads left so right lands on the width boundary', () => {
    const line = padBetween('ctx ▓▓', '512k/1M', 20);
    expect(styledWidth(line)).toBe(20);
    expect(line.endsWith('512k/1M')).toBe(true);
  });
  it('degrades to a single space when there is no room', () => {
    expect(padBetween('abcdef', 'ghij', 6)).toBe('abcdef ghij');
  });
});

describe('palette', () => {
  it('exposes cyan/green/yellow/red used by the segment bar', () => {
    for (const key of ['cyan', 'green', 'yellow', 'red', 'blue', 'magenta'] as const) {
      expect(typeof palette[key]).toBe('function');
    }
  });
});

describe('fitTail', () => {
  it('fits the reasoning tail to display columns without splitting wide chars', () => {
    expect(fitTail('hello', 10)).toBe('hello');
    expect(fitTail('hello', 4)).toBe('ello');
    // CJK counts 2 columns each: 5 chars = 10 columns fit exactly.
    expect(fitTail('你好世界', 10)).toBe('你好世界');
    // 8 columns still fit a budget of 9; a budget of 7 drops 你 (6 kept).
    expect(fitTail('你好世界', 9)).toBe('你好世界');
    expect(fitTail('你好世界', 7)).toBe('好世界');
    // The result never exceeds the budget even for mixed-width text.
    const tail = fitTail('a你b好c', 5);
    expect([...tail].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)).toBeLessThanOrEqual(5);
  });
});

describe('markdown lite', () => {
  const p = plainPalette;

  it('strips inline markdown symbols', () => {
    const lines = renderMarkdownLite('run `pnpm test` and **verify** the output', p);
    expect(lines).toEqual(['run pnpm test and verify the output']);
  });

  it('normalizes bullets and headings, hides fence markers', () => {
    const lines = renderMarkdownLite('# 标题\n\n- 第一项\n* 第二项\n```js\ncode();\n```', p);
    expect(lines).toEqual(['标题', '', '· 第一项', '· 第二项', 'code();']);
  });

  it('keeps plain paragraphs byte-identical', () => {
    expect(renderMarkdownLite('你好\n世界', p)).toEqual(['你好', '世界']);
  });

  it('streams incrementally: complete lines cache, only the tail re-renders', () => {
    const md = createMarkdownRenderer(p);
    expect(md.push('# 标题\n')).toEqual(['标题']);
    expect(md.push('第一行\n第二')).toEqual(['标题', '第一行', '第二']);
    expect(md.push('行')).toEqual(['标题', '第一行', '第二行']);
    // A partially typed fence marker must not toggle fence state early and
    // leaves no premature output; the committed newline confirms the line.
    expect(md.push('\n```')).toEqual(['标题', '第一行', '第二行']);
    expect(md.push('`\ncode();\n```\n')).toEqual(['标题', '第一行', '第二行', 'code();']);
    // A new open fence renders its lines dim; the state survives pushes.
    expect(md.push('```js\nconst x = 1;\n')).toEqual(['标题', '第一行', '第二行', 'code();', 'const x = 1;']);
  });
});

describe('composer layout', () => {
  it('wraps a short single line with the caret at its end', () => {
    const wrap = wrapComposer('hello', 5, 20);
    expect(wrap.rows).toEqual(['hello']);
    expect(wrap.caretRow).toBe(0);
    expect(wrap.caretCol).toBe(5);
    expect(wrap.rowStart).toEqual([0]);
  });

  it('wraps CJK input by display width and keeps the caret inside its row', () => {
    const wrap = wrapComposer('你好世界', 4, 6);
    expect(wrap.rows).toEqual(['你好世', '界']);
    expect(wrap.caretRow).toBe(1);
    expect(wrap.caretCol).toBe(2); // 界 = 2 columns
    // caret sits past the last char → UTF-16 offset equals the row length
    expect(layoutComposer('你好世界', 4, 6, 8).rows[1]?.caretIdx).toBe(1);
  });

  it('splits explicit newlines into rows and locates the caret per row', () => {
    const layout = layoutComposer('ab\ncd', 3, 20, 8);
    expect(layout.totalRows).toBe(2);
    expect(layout.cursorRow).toBe(1);
    expect(layout.cursorCol).toBe(0);
    expect(layout.rows[0]).toEqual({ text: 'ab', caretIdx: -1 });
    expect(layout.rows[1]).toEqual({ text: 'cd', caretIdx: 0 });
  });

  it('windows long input around the caret with overflow hints', () => {
    const input = Array.from({ length: 12 }, (_, i) => `l${i}`).join('\n');
    const end = input.length;
    const atEnd = layoutComposer(input, end, 20, 4);
    expect(atEnd.totalRows).toBe(12);
    expect(atEnd.hiddenAbove).toBe(8);
    expect(atEnd.hiddenBelow).toBe(0);
    expect(atEnd.cursorRow).toBe(3);
    expect(atEnd.rows).toHaveLength(4);
    const atTop = layoutComposer(input, 0, 20, 4);
    expect(atTop.hiddenAbove).toBe(0);
    expect(atTop.hiddenBelow).toBe(8);
    expect(atTop.cursorRow).toBe(0);
  });

  it('handles empty input as one empty row with the caret at the origin', () => {
    const layout = layoutComposer('', 0, 20, 8);
    expect(layout.rows).toEqual([{ text: '', caretIdx: 0 }]);
    expect(layout.cursorRow).toBe(0);
    expect(layout.cursorCol).toBe(0);
  });

  it('moves the cursor across visual rows keeping the column', () => {
    // 'abcdef' / 'xy': caret at end of row 1 (utf16 pos 9), up → row 0 col 2
    expect(cursorAfterVerticalMove('abcdef\nxy', 9, 20, -1)).toBe(2);
    expect(cursorAfterVerticalMove('abcdef\nxy', 2, 20, 1)).toBe(9);
    // clamped at both ends
    expect(cursorAfterVerticalMove('abcdef\nxy', 9, 20, 1)).toBe(9);
    expect(cursorAfterVerticalMove('abcdef\nxy', 2, 20, -1)).toBe(2);
    // CJK row: caretCol 1 clamps to the first char boundary past it
    expect(cursorAfterVerticalMove('中文\na', 4, 20, -1)).toBe(1);
  });
});

describe('windows toast script', () => {
  it('escapes quotes and flattens newlines for the PowerShell string literals', () => {
    const script = buildWindowsToastScript('Nova', "it's done\nline2");
    expect(script).toContain("$t='Nova'");
    expect(script).toContain("$b='it''s done line2'");
    expect(script).toContain('ToastNotificationManager');
    expect(script).toContain('ShowBalloonTip'); // balloon fallback present
  });
});
