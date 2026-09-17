/**
 * ReplProgress 直测（M9.5 阶段 F）：瞬态行契约——单显示行、\r\x1b[2K 可擦、
 * 无颜色整体静默、子代理进度门闩。假 writer 收集写入，不碰真 stdout。
 */
import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { plainPalette } from '@nova-agent/tui-view';
import type { SubagentProgress } from '@nova-agent/core';
import { ReplProgress } from '../src/repl-progress.js';

function makeFix(over: { useColor?: boolean; cols?: number } = {}) {
  const writes: string[] = [];
  const logged: string[] = [];
  const spinnerLog: string[] = [];
  const prog = new ReplProgress({
    paint: () => plainPalette,
    useColor: over.useColor ?? true,
    spinner: {
      start: () => spinnerLog.push('start'),
      stop: () => spinnerLog.push('stop'),
    },
    write: (c) => writes.push(c),
    writeln: (l) => logged.push(l),
    cols: () => over.cols ?? 80,
  });
  return { prog, writes, logged, spinnerLog };
}

const doneUsage = {
  turns: 3,
  toolCalls: 2,
  promptTokens: 100,
  completionTokens: 40,
  cachedTokens: 0,
  missTokens: 0,
  missTurns: 0,
  elapsedMs: 1500,
};

describe('ReplProgress 无颜色门', () => {
  it('useColor=false 时推理尾行/输出尾行/子代理行全部静默，且不碰 spinner', () => {
    const { prog, writes, logged, spinnerLog } = makeFix({ useColor: false });
    prog.onReasoning('想想');
    prog.onToolCallStart('bash', 'c1');
    prog.onToolProgress('out');
    prog.onToolCallEnd();
    prog.onSubagentProgress({ type: 'start', label: 'scout' } as SubagentProgress);
    expect(writes).toEqual([]);
    expect(logged).toEqual([]);
    expect(spinnerLog).toEqual(['stop']); // onToolCallStart→beforeRow 仍停表（永久行要落）
  });
});

describe('ReplProgress 推理尾行', () => {
  it('换行折成 ⏎、整行恒为一条 \r\x1b[2K 可擦的单物理行', () => {
    const { prog, writes } = makeFix();
    prog.onReasoning('第一行\n第二行');
    const last = writes.at(-1) as string;
    expect(last.startsWith('\r\x1b[2K\x1b[2m  ⋯ ')).toBe(true);
    expect(last).toContain('第一行 ⏎ 第二行');
    expect(last).not.toContain('\n');
  });
  it('累计尾段裁进列预算（超宽截左保尾，不折行）', () => {
    const { prog, writes } = makeFix({ cols: 30 });
    prog.onReasoning('x'.repeat(100));
    const tail = (writes.at(-1) as string).slice('\r\x1b[2K\x1b[2m  ⋯ '.length);
    const budget = 30 - styledWidth('  ⋯ ') - 1;
    expect(styledWidth(tail)).toBeLessThanOrEqual(budget);
    expect(tail.endsWith('x')).toBe(true); // 保尾
  });
  it('endReasoning 只在行活着时补复位+换行，随后一次落定', () => {
    const { prog, writes } = makeFix();
    prog.endReasoning();
    expect(writes).toEqual([]);
    prog.onReasoning('a');
    prog.endReasoning();
    expect(writes.at(-1)).toBe('\x1b[0m\n');
    prog.endReasoning();
    expect(writes.filter((w) => w === '\x1b[0m\n')).toHaveLength(1);
  });
});

describe('ReplProgress bash 输出尾行', () => {
  it('只显示当前未完行；行尾换行后不写、跨多行只显最后一段', () => {
    const { prog, writes } = makeFix();
    prog.onToolProgress('alpha');
    expect((writes.at(-1) as string).endsWith('  └ alpha\x1b[0m')).toBe(true);
    prog.onToolProgress('123   ');
    expect((writes.at(-1) as string).endsWith('alpha123\x1b[0m')).toBe(true);
    const n = writes.length;
    prog.onToolProgress('\n'); // 行落定——尾段空 → 不写新行
    expect(writes).toHaveLength(n);
    prog.onToolProgress('beta\ngamma'); // 只显示最后一段 gamma
    expect((writes.at(-1) as string).endsWith('  └ gamma\x1b[0m')).toBe(true);
  });
  it('clearProgress 只在活行时擦；endTurn 瞬态行全落定', () => {
    const { prog, writes, spinnerLog } = makeFix();
    prog.clearProgress();
    expect(writes).toEqual([]);
    prog.onToolProgress('run');
    prog.endTurn();
    expect(writes).toContain('\r\x1b[2K');
    expect(spinnerLog.filter((s) => s === 'stop').length).toBeGreaterThan(0);
  });
});

describe('ReplProgress 子代理门闩', () => {
  it('未绑定 subagent 调用时进度静默；绑定后每次生命周期一行暗色', () => {
    const { prog, logged } = makeFix();
    prog.onSubagentProgress({ type: 'start', label: 'scout' } as SubagentProgress);
    expect(logged).toEqual([]);
    prog.onToolCallStart('subagent', 'call-9');
    prog.onSubagentProgress({ type: 'start', label: 'scout' } as SubagentProgress);
    prog.onSubagentProgress({
      type: 'tool_call',
      label: 'scout',
      call: { name: 'read_file', args: {}, rawArgs: '{}', id: 'n1' },
    } as SubagentProgress);
    prog.onSubagentProgress({ type: 'done', label: 'scout', usage: doneUsage } as SubagentProgress);
    expect(logged).toHaveLength(3);
    expect(logged[0]).toContain('子代理 scout 启动');
    expect(logged[1]).toContain('scout › read_file');
    expect(logged[2]).toMatch(/scout 完成 · 3 轮 · 2 工具 · 140 tok · 1\.5s/);
  });
  it('其他工具的嵌套调用不借道显形；tool_call_end 解除门闩', () => {
    const { prog, logged } = makeFix();
    prog.onToolCallStart('run_code', 'call-1');
    prog.onSubagentProgress({ type: 'start', label: 'x' } as SubagentProgress);
    expect(logged).toEqual([]);
    prog.onToolCallStart('subagent', 'call-2');
    prog.onToolCallEnd();
    prog.onSubagentProgress({ type: 'start', label: 'x' } as SubagentProgress);
    expect(logged).toEqual([]);
  });
});

describe('ReplProgress 行落定顺序', () => {
  it('永久行前 beforeRow 擦推理行尾并停表；onText 流式正文同一路径', () => {
    const { prog, writes, spinnerLog } = makeFix();
    prog.onReasoning('hmm');
    prog.beforeRow();
    expect(writes.at(-1)).toBe('\x1b[0m\n');
    expect(spinnerLog.at(-1)).toBe('stop');
    prog.onText('answer');
    expect(writes.at(-1)).toBe('answer');
  });
});
