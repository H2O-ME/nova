/**
 * The command row in the transcript: `command` run/done events in, one closed
 * line out. The reducer's own contract for these events — appending where it
 * happened, closing the row that is still open, and leaving a line behind for a
 * name the kernel refused (so a click never vanishes without a trace).
 */
import { describe, expect, it } from 'vitest';
import type { KernelEvent } from '@nova-agent/core';
import { initialState, reduce, type Block, type UiState } from '../src/state.js';

function command(name: string, phase: 'run' | 'done', text?: string): KernelEvent {
  return { type: 'command', name, phase, ...(text !== undefined ? { text } : {}) };
}

function feed(events: KernelEvent[], state: UiState = initialState): UiState {
  return events.reduce((acc, event) => reduce(acc, { type: 'event', event }), state);
}

function rows(state: UiState): Block[] {
  return state.blocks.filter((block) => block.kind === 'command');
}

describe('command rows', () => {
  it('opens on run and closes the same row on done', () => {
    const opened = feed([command('compact', 'run')]);
    expect(rows(opened)).toMatchObject([{ name: 'compact', running: true }]);

    const closed = feed([command('compact', 'run'), command('compact', 'done', '压缩完成')], opened === opened ? initialState : initialState);
    expect(rows(closed)).toMatchObject([{ name: 'compact', running: false, text: '压缩完成' }]);
    expect(closed.seq).toBe(1);
  });

  it('keeps the order of two runs of the same command (two lines, not one)', () => {
    const state = feed([
      command('compact', 'run'),
      command('compact', 'done'),
      command('compact', 'run'),
      command('compact', 'done', '第二次'),
    ]);
    expect(rows(state).map((row) => (row.kind === 'command' ? row.text : undefined))).toEqual([undefined, '第二次']);
  });

  it('leaves a line for a done with no run (a name the registry refused)', () => {
    const state = feed([command('teleport', 'done', '未知命令：/teleport')]);
    expect(rows(state)).toMatchObject([{ name: 'teleport', running: false, text: '未知命令：/teleport' }]);
  });

  it('does not blank the text a row already carries when done says nothing', () => {
    const state = feed([
      { type: 'command', name: 'compact', phase: 'run' },
      { type: 'command', name: 'compact', phase: 'done', text: '进行中' },
      { type: 'command', name: 'compact', phase: 'done' },
    ]);
    expect(rows(state).at(-1)).toMatchObject({ running: false, text: '进行中' });
  });

  it('leaves a settled row alone and starts a new one', () => {
    const state = feed([command('skill', 'run'), command('skill', 'done'), command('skill', 'run')]);
    expect(rows(state).map((row) => (row.kind === 'command' ? row.running : undefined))).toEqual([false, true]);
  });
});