/**
 * The command runner's contract (M11 批5): the semantics both shells share.
 *
 * These are the facts that must NOT differ between `nova` and `nova --repl` —
 * what a command does to the kernel, how its arguments are parsed, and which
 * line comes back. The shells only choose how a line is shown, so a fake "show
 * it" (a `note` array) is enough to test the whole table.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentSession, PtcMode } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import { runAgentCommand, type CommandPorts } from '../src/command-runner.js';
import type { ThemeName } from '../src/command-core.js';

interface Harness {
  ports: CommandPorts;
  lines: string[];
  setModelCalls: string[];
  cleared: number;
  exited: number;
  mode(): PtcMode;
}

function harness(over: Partial<CommandPorts> = {}): Harness {
  const lines: string[] = [];
  const setModelCalls: string[] = [];
  const state = {
    cleared: 0,
    exited: 0,
    mode: 'native' as PtcMode,
    approval: 'read-only' as const,
    theme: 'dark' as ThemeName,
  };
  const agent = {
    running: false,
    session: { file: '/home/.nova/sessions/2026/09/19/sess_1.jsonl' },
    messages: [],
    usageSnapshot: () => ({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 }),
    lastUsage: undefined,
    lastPromptTokens: 0,
    compact: async () => ({ summary: '摘要', retained: 3 }),
  };
  const kernel = {
    agent,
    skills: [{ name: 'demo', description: '示范技能', file: '/home/.nova/skills/demo/SKILL.md' }],
    permission: {
      get approvalMode() {
        return state.approval;
      },
      setMode: (mode: 'read-only' | 'auto-edit' | 'full') => {
        state.approval = mode;
      },
    },
    host: { toolEntries: [], commandEntries: [] },
    codeMode: () => state.mode,
    rootDir: () => '/work',
    newAgentSession: async () => ({ session: { id: 'sess_2', file: '/home/.nova/sessions/2026/09/19/sess_2.jsonl' } }) as unknown as AgentSession,
  };
  const ports: CommandPorts = {
    kernel: kernel as unknown as Kernel,
    client: {
      model: 'model-a',
      setModel: (model: string) => setModelCalls.push(model),
      setSessionId: () => undefined,
    },
    config: { provider: { baseURL: 'http://x', apiKey: 'k', model: 'model-a' } } as unknown as CommandPorts['config'],
    approvalOverride: undefined,
    theme: () => state.theme,
    setTheme: (theme) => {
      state.theme = theme;
    },
    note: (text) => lines.push(text),
    fetchModels: async () => ['model-a', 'model-b'],
    pickModel: async (models) => models[1],
    bindSession: () => undefined,
    clear: () => {
      state.cleared += 1;
    },
    modeHint: '（测试壳）',
    exit: () => {
      state.exited += 1;
    },
    ...over,
  };
  return {
    ports,
    lines,
    setModelCalls,
    get cleared() {
      return state.cleared;
    },
    get exited() {
      return state.exited;
    },
    mode: () => state.mode,
  } as Harness & { cleared: number; exited: number };
}

describe('the shared command runner', () => {
  it('cycles the approval level on the kernel, not in the shell', async () => {
    const h = harness();
    expect(await runAgentCommand('/approvals', h.ports)).toBe('handled');
    expect(h.mode()).toBe('native'); // untouched
    expect(h.lines.join('\n')).toContain('自动编辑');
  });

  it('parses a theme name and applies it through the port', async () => {
    const h = harness();
    await runAgentCommand('/theme plain', h.ports);
    expect(h.ports.theme()).toBe('plain');
    expect(h.lines.at(-1)).toContain('plain');

    await runAgentCommand('/theme 紫色', h.ports);
    expect(h.lines.at(-1)).toContain('未知主题');
  });

  it('switches the model the user picks, and says so when it is already current', async () => {
    const h = harness();
    await runAgentCommand('/model', h.ports);
    expect(h.setModelCalls).toEqual(['model-b']);
    expect(h.lines.at(-1)).toContain('model-b');

    const same = harness({ pickModel: async () => 'model-a' });
    await runAgentCommand('/model', same.ports);
    expect(same.setModelCalls).toEqual([]);
    expect(same.lines.at(-1)).toContain('已是当前模型');

    const cancelled = harness({ pickModel: async () => undefined });
    await runAgentCommand('/model', cancelled.ports);
    expect(cancelled.lines.at(-1)).toBe('已取消');

    const empty = harness({ fetchModels: async () => [] });
    await runAgentCommand('/model', empty.ports);
    expect(empty.lines.at(-1)).toContain('未返回任何模型');
  });

  it('expands /skill into a prompt — the bug the duplicated copies shipped', async () => {
    // The skill body comes off disk, so this one needs a real file.
    const dir = await mkdtemp(path.join(tmpdir(), 'nova-skill-'));
    const file = path.join(dir, 'SKILL.md');
    await writeFile(file, '示范正文');
    const h = harness({ kernel: { skills: [{ name: 'demo', description: '示范技能', file }] } } as never);
    const outcome = await runAgentCommand('/skill demo', h.ports);
    expect(typeof outcome).toBe('object');
    expect(typeof outcome === 'object' && outcome.prompt).toContain('demo');

    const unknown = harness();
    expect(await runAgentCommand('/skill nope', unknown.ports)).toBe('handled');
    expect(unknown.lines.at(-1)).toContain('未知技能');
  });

  it('clears through the shell, and refuses to compress mid-turn', async () => {
    const h = harness();
    await runAgentCommand('/clear', h.ports);
    expect(h.cleared).toBe(1);

    const busy = harness();
    (busy.ports.kernel.agent as { running: boolean }).running = true;
    await runAgentCommand('/compact', busy.ports);
    expect(busy.lines.at(-1)).toContain('本轮进行中');
  });

  it('exits through the shell, and reports mode with the shell’s own hint', async () => {
    const h = harness();
    expect(await runAgentCommand('/exit', h.ports)).toBe('exit');
    expect(h.exited).toBe(1);

    await runAgentCommand('/mode', h.ports);
    expect(h.lines.at(-1)).toContain('（测试壳）');
  });

  it('names an unknown command instead of guessing', async () => {
    const h = harness();
    await runAgentCommand('/nope', h.ports);
    expect(h.lines.at(-1)).toContain('/nope');
  });
});