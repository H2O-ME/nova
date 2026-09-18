import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import {
  allocateCells,
  approvalChip,
  buildToolFoldRows,
  contextBar,
  contextGaugeForms,
  contextLegend,
  cursorAfterVerticalMove,
  fitTail,
  gaugeHitWidth,
  humanTokens,
  isReadOnlyTool,
  layoutComposer,
  modelTail,
  padBetween,
  palette,
  planContextSegments,
  plainPalette,
  railLine,
  segmentBar,
  sparkline,
  statusLine,
  usageUrgency,
  bgSubagentDoneLine,
  bgSubagentLine,
  subagentDetailRows,
  subagentLiveLine,
  toolArgSummary,
  toolDoneLine,
  readGroupLine,
  toolStartLine,
  wrapComposer,
  type ContextSegment,
  type Palette,
} from '../src/index.js';

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
    expect(toolStartLine(p, 'bash', '{"command":"echo hi"}')).toBe('  • 执行命令 echo hi');
    expect(toolStartLine(p, 'read_file', '{"path":"a.txt"}')).toContain('读取文件');
    expect(toolStartLine(p, 'read_file', '{"path":"a.txt"}')).not.toContain('{');
    expect(toolStartLine(p, 'bash', '{"command":"echo hi"}', '⠙')).toContain('⠙');
  });

  it('classifies read-only tools and renders the verb group line', () => {
    expect(isReadOnlyTool('read_file')).toBe(true);
    expect(isReadOnlyTool('list_dir')).toBe(true);
    expect(isReadOnlyTool('bash')).toBe(false);

    // 桶按首现顺序排布，计数进短语而非名字列表。
    const done = readGroupLine(
      p,
      { names: ['read_file', 'search_files', 'read_file'], running: 0, failed: 0, durationMs: 500 },
    );
    expect(done).toContain('✓');
    expect(done).toContain('读取 2 个文件, 搜索 1 个模式');
    expect(done).toContain('0.5s');
    expect(done).toContain('▸');

    // 有成员在跑：整体现在时（正在…）+ 活动标记，✓ 让位。
    const running = readGroupLine(
      p,
      { names: ['read_file', 'read_file'], running: 1, failed: 0, durationMs: 800 },
    );
    expect(running).toContain('正在读取 2 个文件');
    expect(running).not.toContain('✓');

    // 失败成员并进同一行：红色 N 失败 后缀，不另起行。
    const failed = readGroupLine(
      p,
      { names: ['read_file', 'read_file'], running: 0, failed: 1, durationMs: 500 },
    );
    expect(failed).toContain('· 1 失败');

    // 展开态 affordance 翻成 ▾。
    const expanded = readGroupLine(
      p,
      { names: ['list_dir'], running: 0, failed: 0, durationMs: 200, expanded: true },
    );
    expect(expanded).toContain('列出 1 个目录');
    expect(expanded).toContain('▾');
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

  it('tool lines built at the gutter budget never wrap into orphan rows', () => {
    // wrapBlock folds gutter blocks at cols-1-gutterRest; builders must clip
    // into the SAME budget. A line wider than it folds, and the tail
    // (` · 8 行 · 5.9s`) breaks onto an orphan continuation row.
    const gutterRest = '      '; // 6 cols, matches TOOL_GUTTER in tui-mode
    for (const cols of [60, 80, 100, 120, 160]) {
      const budget = cols - 1 - gutterRest.length;
      const running = toolStartLine(p, 'bash', `{"command":"${'x'.repeat(300)}"}`, '•', budget) + ' · 12s';
      const done = toolDoneLine(
        p,
        'read_file',
        '{"path":"' + 'x'.repeat(120) + '.ts"}',
        Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'),
        5900,
        budget,
      )[0]!;
      const group = readGroupLine(
        p,
        {
          names: ['read_file', 'read_file', 'list_dir', 'search_files', 'search_files'],
          running: 2,
          failed: 1,
          durationMs: 5900,
        },
        budget,
      );
      for (const line of [running, done, group]) {
        expect(styledWidth(line)).toBeLessThanOrEqual(cols - 1);
      }
    }
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

  it('sanitizes external tool output before it enters the tool lines', () => {
    // A colored child process erases its own row (`\x1b[2K`) and rewrites
    // with `\r`; neither control write may ride into the frame string.
    const done = toolDoneLine(p, 'bash', '{"command":"ls"}', 'ok\x1b[2Kdone\rnext', 50);
    expect(done.join('\n')).toContain('okdone');
    expect(done.join('\n')).not.toContain('\x1b[2K');
    expect(done.join('\n')).not.toContain('\r');
    const failed = toolDoneLine(p, 'bash', '{"command":"cargo build"}', 'exit: 101\n\x1b[2Kerror: boom', 3200);
    expect(failed[1]).toContain('error: boom');
    expect(failed.join('\n')).not.toContain('\x1b[2K');
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

  it('pct follows used, never the segment sum (the "0/1.05M · 5%" regression)', () => {
    // A zeroed usage anchor (gateway usage chunk without prompt_tokens) once
    // printed nums from used=0 while pct read the unscaled segment sum.
    const fat: ContextSegment[] = [{ label: '消息', tokens: 52000, color: 'yellow' }];
    const [t0] = contextGaugeForms(p, { segments: fat, used: 0, capacity: 1050000, compact: undefined }, 120);
    expect(t0).toContain('0/1.05M');
    expect(t0).toContain(' 0%');
    expect(t0).not.toContain(' 5%');
  });

  it('tiny non-zero usage reads <1%, never a misleading 0%', () => {
    const tiny: ContextSegment[] = [{ label: '提示词', tokens: 2600, color: 'cyan' }];
    const [t0, , t2] = contextGaugeForms(p, { segments: tiny, used: 2600, capacity: 1_050_000, compact: undefined }, 160);
    expect(t0).toContain('<1%');
    // '<1' 与 ' 0' 同宽：位数不挪分隔符的约定在低占比下依然成立
    expect(t2).toContain('<1%');
    const [zero] = contextGaugeForms(p, { segments: [], used: 0, capacity: 10000, compact: undefined }, 160);
    expect(zero).toContain(' 0%');
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

describe('gauge urgency ramp + hover morph (M10 组件1/2)', () => {
  const segs: ContextSegment[] = [{ label: '历史', tokens: 3000, color: 'yellow' }];

  it('usageUrgency snaps Grok breakpoints at segment midpoints', () => {
    expect(usageUrgency(0.49)).toBe('neutral');
    expect(usageUrgency(0.5)).toBe('cyan');
    expect(usageUrgency(0.69)).toBe('cyan');
    expect(usageUrgency(0.7)).toBe('yellow');
    expect(usageUrgency(0.89)).toBe('yellow');
    expect(usageUrgency(0.9)).toBe('red');
    expect(usageUrgency(1.4)).toBe('red');
  });

  it('the pct color follows the ramp (ANSI palette)', () => {
    const at = (ratio: number): string =>
      contextGaugeForms(
        palette,
        { segments: [{ label: '历史', tokens: Math.round(10000 * ratio), color: 'yellow' }], used: Math.round(10000 * ratio), capacity: 10000, compact: undefined },
        160,
      )[2];
    expect(at(0.3)).toContain(' 30%'); // neutral: unpainted
    expect(at(0.3)).not.toContain('\x1b[32m 30%');
    expect(at(0.55)).toContain('\x1b[36m'); // cyan
    expect(at(0.8)).toContain('\x1b[33m'); // yellow
    expect(at(0.95)).toContain('\x1b[31m'); // red long before over
  });

  it('T2 hover swaps bar cells for the numbers at identical total width', () => {
    const v = { segments: segs, used: 5200, capacity: 1_050_000, compact: undefined };
    const base = contextGaugeForms(plainPalette, v, 100);
    const hover = contextGaugeForms(plainPalette, v, 100, true);
    expect(base[2]).not.toContain('5.2k/1.05M');
    expect(hover[2]).toContain('5.2k/1.05M');
    expect(styledWidth(hover[2])).toBe(styledWidth(base[2]));
    // 形态换位不挪右缘：三档里只有 T2 变化。
    expect(hover[0]).toBe(base[0]);
    expect(hover[1]).toBe(base[1]);
  });

  it('too little bar to steal → the hover morph is a no-op', () => {
    // cols=75 gives T2 a 6-cell bar; the 11-wide numbers do not fit.
    const v = { segments: segs, used: 5200, capacity: 1_050_000, compact: undefined };
    const base = contextGaugeForms(plainPalette, v, 75);
    const hover = contextGaugeForms(plainPalette, v, 75, true);
    expect(hover[2]).toBe(base[2]);
  });

  it('gaugeHitWidth counts display cols to the first separator, ANSI-free', () => {
    const line = `${palette.green('  上下文 ██░░')} ${palette.dim('│')} model`;
    // '  上下文 ██░░' = 2 + 6(CJK×2) + 1 + 4 cols，再加 separator 前的空格 1。
    expect(gaugeHitWidth(line)).toBe(2 + 6 + 1 + 4 + 1);
    expect(gaugeHitWidth('  整行都被裁掉的仪表')).toBe(2 + 9 * 2);
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

describe('subagent live line & detail rows', () => {
  const base = {
    toolCounts: new Map([['list_dir', 3]]),
    turns: 2,
    promptTokens: 100,
    completionTokens: 20,
  };

  it('live line without detail carries no affordance marker', () => {
    expect(subagentLiveLine(p, { label: '统计', ...base }, '•')).not.toContain('▸');
    expect(subagentLiveLine(p, { label: '统计', ...base }, '•')).toContain('list_dir×3');
  });

  it('expandable detail renders ▸/▾ affordance', () => {
    expect(subagentLiveLine(p, { label: '统计', ...base, expandable: true }, '•')).toContain(' ▸ ');
    expect(subagentLiveLine(p, { label: '统计', ...base, expandable: true, expanded: true }, '•')).toContain(' ▾ ');
  });

  it('detail rows dim each entry and clip to the budget', () => {
    const rows = subagentDetailRows(p, ['› list_dir {"path":"src"}', `› bash ${'x'.repeat(200)}`], 40);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe('  › list_dir {"path":"src"}');
    // eslint-disable-next-line no-control-regex -- plainPalette keeps rows ANSI-free, the strip is belt-and-braces
    for (const row of rows) expect(styledWidth(row.replace(/\x1b\[[0-9;]*m/g, ''))).toBeLessThanOrEqual(40);
  });

  it('empty detail renders no rows', () => {
    expect(subagentDetailRows(p, [], 40)).toEqual([]);
  });
});

describe('background subagent rows (run_in_background visibility)', () => {
  it('live row shows elapsed + latest nested activity', () => {
    const line = bgSubagentLine(p, { label: 'decode-sha', elapsedSecs: 45, progress: '12 tools · read_file a.ts {"path":"x"}' });
    expect(line).toContain('◈ 子代理');
    expect(line).toContain('decode-sha');
    expect(line).toContain('45s');
    expect(line).toContain('12 tools');
  });

  it('live row without progress still shows the elapsed clock', () => {
    const line = bgSubagentLine(p, { label: 'scout', elapsedSecs: 3 });
    expect(line).toContain('· 3s');
    expect(line).not.toContain('tools');
  });

  it('done row maps status to Chinese and carries the usage trailer', () => {
    expect(bgSubagentDoneLine(p, { label: 'scout', status: 'completed', detail: '[subagent: scout · 3 turns · 9 tools · 100+20 tok]' })).toContain(
      '完成',
    );
    expect(bgSubagentDoneLine(p, { label: 'scout', status: 'failed' })).toContain('失败');
    expect(bgSubagentDoneLine(p, { label: 'scout', status: 'killed' })).toContain('已停止');
  });
});

describe('buildToolFoldRows (tri-state fold source, M10 组件3)', () => {
  const base = ['HEAD'];

  it('single-line or empty content is not foldable', () => {
    expect(buildToolFoldRows(p, base, 'one line', 72)).toBeUndefined();
    expect(buildToolFoldRows(p, base, '', 72)).toBeUndefined();
    expect(buildToolFoldRows(p, base, '\n  \n', 72)).toBeUndefined();
  });

  it('short body: preview equals full, no truncation footer', () => {
    const f = buildToolFoldRows(p, base, 'a\nb\nc', 72)!;
    expect(f.full).toHaveLength(3);
    expect(f.preview).toEqual(f.full);
    expect(f.base).toBe(base);
  });

  it('long body: preview is 12 rows + a counted footer; full keeps every row', () => {
    const content = Array.from({ length: 20 }, (_, i) => `row ${i}`).join('\n');
    const f = buildToolFoldRows(p, base, content, 72)!;
    expect(f.full).toHaveLength(20);
    expect(f.preview).toHaveLength(13);
    expect(f.preview[12]).toContain('还有 8 行');
  });

  it('extreme body caps at FOLD_MAX_ROWS with a not-loaded note', () => {
    const content = Array.from({ length: 500 }, (_, i) => `r${i}`).join('\n');
    const f = buildToolFoldRows(p, base, content, 72)!;
    expect(f.full).toHaveLength(401); // 400 载入 + 1 未载入提示
    expect(f.full[400]).toContain('另有 100 行未载入');
    expect(f.preview[12]).toContain('还有 488 行');
  });

  it('external escapes are sanitized before they enter fold rows', () => {
    const f = buildToolFoldRows(p, base, '\x1b[2Krisky\nsecond', 72)!;
    for (const row of f.full) expect(row).not.toContain('\x1b[2K');
  });

  it('every fold row fits the budget (no orphan continuations under the gutter)', () => {
    const content = Array.from({ length: 30 }, (_, i) => `${i} ${'长'.repeat(80)}`).join('\n');
    const f = buildToolFoldRows(p, base, content, 72)!;
    for (const row of [...f.preview, ...f.full]) {
      expect(styledWidth(row)).toBeLessThanOrEqual(72);
    }
  });
});

describe('state rail (M10 组件5)', () => {
  it('plain shape is state-invariant: `  ▌ text`——色彩承载状态，字形不承载', () => {
    for (const state of ['running', 'done', 'failed'] as const) {
      expect(railLine(p, state, 0, 'v', 72)).toBe('  ▌ v');
    }
  });

  it('rail color IS the state; running pulses on phase (ANSI palette)', () => {
    expect(railLine(palette, 'done', 0, 'v', 72)).toContain('\x1b[32m▌');
    expect(railLine(palette, 'failed', 0, 'v', 72)).toContain('\x1b[31m▌');
    expect(railLine(palette, 'running', 0, 'v', 72)).toContain('\x1b[36m▌');
    expect(railLine(palette, 'running', 1, 'v', 72)).toContain('\x1b[2m▌');
    // 静态状态不随相位变化——只有 running 呼吸。
    expect(railLine(palette, 'done', 1, 'v', 72)).toContain('\x1b[32m▌');
  });

  it('rail row respects the whole-row budget', () => {
    expect(styledWidth(railLine(p, 'done', 0, 'x'.repeat(200), 40))).toBeLessThanOrEqual(40);
    const cjk = railLine(p, 'failed', 0, '错'.repeat(40), 30);
    expect(styledWidth(cjk)).toBeLessThanOrEqual(30);
  });

  it('failed toolDoneLine hangs the first error under a red rail, not an elbow', () => {
    const failed = toolDoneLine(palette, 'bash', '{"command":"pnpm test"}', 'exit: 1\nboom', 3200, 80);
    expect(failed).toHaveLength(2);
    expect(failed[1]).toContain('\x1b[31m▌');
    expect(failed[1]).toContain('boom');
    expect(failed[1]).not.toContain('└');
    // 无输出分支同样走导轨行
    const quiet = toolDoneLine(p, 'bash', '{"command":"false"}', 'exit: 1', 50, 80);
    expect(quiet[1]).toBe('  ▌ 命令无输出（退出码 1）');
  });

  it('fold body rails in the settled state (green done / red failed), trailer included', () => {
    const done = buildToolFoldRows(palette, ['HEAD'], 'a\nb', 72)!;
    expect(done.full[0]).toContain('\x1b[32m▌');
    const failed = buildToolFoldRows(palette, ['HEAD'], 'a\nb', 72, 'failed')!;
    expect(failed.full[1]).toContain('\x1b[31m▌');
    const long = buildToolFoldRows(p, ['H'], Array.from({ length: 20 }, (_, i) => `r${i}`).join('\n'), 72)!;
    expect(long.preview[12]).toContain('▌ … 还有 8 行');
    expect(long.preview[12]).not.toContain('└');
  });
});
