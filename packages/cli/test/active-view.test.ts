import type { ToolCall } from '@nova-agent/core';
import { palette, plainPalette } from '@nova-agent/tui-view';
import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../src/commands.js';
import { resolveActiveView } from '../src/tui/frame.js';
import { TuiStore } from '../src/tui/store.js';

const CALL: ToolCall = { id: 'c1', name: 'bash', args: { command: 'ls' }, rawArgs: '{"command":"ls"}' };
const NO_TOKENS = () => undefined;
const base = {
  commandMatches: [] as CommandSpec[],
  modelContextTokens: NO_TOKENS,
  currentModel: 'm1',
  currentSessionFile: '/cur.jsonl',
};
const spec = (name: string): CommandSpec => ({ name, usage: name, description: 'd' });

describe('resolveActiveView', () => {
  it('renders nothing when no popup state is set', () => {
    const store = new TuiStore(() => undefined);
    expect(resolveActiveView(store, plainPalette, 80, base)).toEqual([]);
  });

  it('approval outranks pickers and the command palette', () => {
    const store = new TuiStore(() => undefined);
    store.approval = {
      call: CALL,
      kind: 'execute',
      resolve: () => undefined,
    };
    store.modelPicker = { models: ['m1'], index: 0 };
    const lines = resolveActiveView(store, plainPalette, 80, { ...base, commandMatches: [spec('/model')] });
    expect(lines.join('\n')).toContain('执行命令');
    expect(lines.join('\n')).not.toContain('m1');
  });

  it('dismissed command palette renders nothing (Esc contract)', () => {
    const store = new TuiStore(() => undefined);
    store.popupDismissed = true;
    const lines = resolveActiveView(store, plainPalette, 80, { ...base, commandMatches: [spec('/model')] });
    expect(lines).toEqual([]);
  });

  it('highlight index follows store.popupIndex inside the visible window', () => {
    const store = new TuiStore(() => undefined);
    store.popupIndex = 2;
    const matches = ['/a', '/b', '/c'].map(spec);
    // 高亮判据需要 ANSI——plainPalette 会剥掉反色，这里用 dark 调色板。
    const lines = resolveActiveView(store, palette, 80, { ...base, commandMatches: matches });
    const highlighted = lines.find((l) => l.includes('\x1b[7m')) ?? '';
    expect(highlighted).toContain('/c');
  });

  it('session picker marks the current session file', () => {
    const store = new TuiStore(() => undefined);
    store.sessionPicker = {
      entries: [
        { file: '/cur.jsonl', mtime: '2026-09-16 10:00', title: 'cur', id: 'a' },
        { file: '/old.jsonl', mtime: '2026-09-15 10:00', title: 'old', id: 'b' },
      ] as never,
      index: 0,
    };
    const lines = resolveActiveView(store, plainPalette, 80, base);
    expect(lines.length).toBeGreaterThan(1);
  });
});
