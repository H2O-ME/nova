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
