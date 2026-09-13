import { describe, expect, it, vi } from 'vitest';
import { handleKey, type KeyEnv } from '../src/tui/keys.js';
import { TuiStore } from '../src/tui/store.js';
import { plainPalette } from '../src/ui.js';
import path from 'node:path';
import fs from 'node:fs';

function createMockEnv(initialInput = ''): { env: KeyEnv; state: { submitted: boolean }; notices: string[] } {
  const store = new TuiStore(() => {});
  store.input = initialInput;
  store.cursorPos = initialInput.length;
  const state = { submitted: false };
  const notices: string[] = [];

  const env: KeyEnv = {
    store,
    paint: plainPalette,
    cols: () => 80,
    rows: () => 24,
    abortLast: vi.fn(),
    exitApp: vi.fn(),
    scheduleRender: vi.fn(),
    preemptRender: vi.fn(),
    submit: () => {
      state.submitted = true;
    },
    toggleCodeMode: vi.fn(),
    canSwitchMode: () => true,
    noteModeSwitchBlocked: vi.fn(),
    switchModel: vi.fn(),
    switchSessionFile: vi.fn(),
    currentModel: () => 'test-model',
    currentSessionFile: () => 'test.jsonl',
    refreshModelMeta: vi.fn(),
    popupMatches: () => [],
    totalWrappedLines: () => 0,
    notice: (lines) => notices.push(...lines),
  };

  return { env, state, notices };
}

describe('TUI Key Handling: multiline paste & images', () => {
  it('pastes multiline text cleanly into the composer without auto-submitting', () => {
    const { env, state } = createMockEnv();
    const multiline = 'line 1\r\nline 2\nline 3';

    handleKey(env, { type: 'paste', text: multiline });

    expect(env.store.input).toBe('line 1\nline 2\nline 3');
    expect(env.store.cursorPos).toBe('line 1\nline 2\nline 3'.length);
    expect(state.submitted).toBe(false);
  });

  it('inserts newline on newline key event (Alt/Shift+Enter)', () => {
    const { env, state } = createMockEnv('hello');

    handleKey(env, { type: 'newline' });
    handleKey(env, { type: 'char', ch: 'world' });

    expect(env.store.input).toBe('hello\nworld');
    expect(state.submitted).toBe(false);
  });

  it('submits on enter key when no popup is open', () => {
    const { env, state } = createMockEnv('hello');

    handleKey(env, { type: 'enter' });

    expect(state.submitted).toBe(true);
  });

  it('automatically recognizes local image file path on paste and formats as markdown image', () => {
    const tmpDir = path.join(process.cwd(), '.tmp-test');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const imgFile = path.join(tmpDir, 'photo.png');
    fs.writeFileSync(imgFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    try {
      const { env, notices } = createMockEnv();
      handleKey(env, { type: 'paste', text: `"${imgFile}"` });

      expect(env.store.input).toBe(`![image](${imgFile}) `);
      expect(notices.some((n) => n.includes('已插入图片路径'))).toBe(true);
      // 诚实范围：nova 不发送图像内容，提示必须写明模型仅见路径。
      expect(notices.some((n) => n.includes('仅见路径'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('truncates oversized pastes and emits a notice', () => {
    const { env, notices } = createMockEnv();
    const oversized = 'a'.repeat(250_000);

    handleKey(env, { type: 'paste', text: oversized });

    expect(env.store.input.length).toBe(200_000);
    expect(notices.some((n) => n.includes('已截断'))).toBe(true);
  });
});

describe('TUI Key Handling: execution mode Tab gate', () => {
  it('toggles mode when the gate allows it (conversation not started)', () => {
    const { env } = createMockEnv();
    const toggle = vi.mocked(env.toggleCodeMode);
    const blocked = vi.mocked(env.noteModeSwitchBlocked);

    handleKey(env, { type: 'tab' });

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(blocked).not.toHaveBeenCalled();
  });

  it('gives visible feedback instead of silently no-op when conversation already started', () => {
    const { env } = createMockEnv();
    const envBlocked: KeyEnv = { ...env, canSwitchMode: () => false };
    const blocked = vi.mocked(envBlocked.noteModeSwitchBlocked);

    handleKey(envBlocked, { type: 'tab' });

    expect(vi.mocked(envBlocked.toggleCodeMode)).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalledTimes(1);
  });
});

describe('TuiStore message queue (mid-turn enqueue)', () => {
  it('drains FIFO and fires onChange on both ends', () => {
    let changes = 0;
    const store = new TuiStore(() => {
      changes += 1;
    });
    expect(store.dequeueMessage()).toBeUndefined();
    store.enqueueMessage('first');
    store.enqueueMessage('second');
    expect(changes).toBe(2);
    expect(store.dequeueMessage()).toBe('first');
    expect(store.dequeueMessage()).toBe('second');
    expect(changes).toBe(4);
    expect(store.messageQueue).toHaveLength(0);
  });
});

describe('click-to-expand subagent detail', () => {
  it('toggles a detail-bearing block between base and base + detail rows', () => {
    const { env } = createMockEnv();
    const store = env.store;
    const block = {
      lines: ['⧉ 子代理 done row'],
      wrapped: undefined,
      detail: { lines: ['  › read_file a.ts'], secs: 3, base: ['⧉ 子代理 done row'] },
      expanded: false,
    };
    store.blocks.push(block);
    store.frameMap = { rows: [{ block, start: 0, count: 1 }], sliceStart: 0, historyRows: 1 };

    handleKey(env, { type: 'click', y: 1 });
    expect(block.expanded).toBe(true);
    expect(block.lines).toEqual(['⧉ 子代理 done row', '  › read_file a.ts']);

    handleKey(env, { type: 'click', y: 1 });
    expect(block.expanded).toBe(false);
    expect(block.lines).toEqual(['⧉ 子代理 done row']);
  });

  it('blocks without detail are not toggled by clicks', () => {
    const { env } = createMockEnv();
    const store = env.store;
    const block = { lines: ['plain row'], wrapped: undefined };
    store.blocks.push(block);
    store.frameMap = { rows: [{ block, start: 0, count: 1 }], sliceStart: 0, historyRows: 1 };

    handleKey(env, { type: 'click', y: 1 });
    expect(block.lines).toEqual(['plain row']);
  });
});
