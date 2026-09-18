import { describe, expect, it, vi } from 'vitest';
import { handleKey, type KeyEnv } from '../src/tui/keys.js';
import { TuiStore } from '../src/tui/store.js';
import type { AskResult } from '@nova-agent/plugins';
import { plainPalette } from '@nova-agent/tui-view';
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
    abortCompact: vi.fn(),
    modeSelectMove: vi.fn(),
    modeSelectConfirm: vi.fn(),
    modeSelectDismiss: vi.fn(),
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

describe('TUI Key Handling: compaction abort', () => {
  it('Ctrl+C during a running compaction cancels it instead of clearing input / exiting', () => {
    const { env } = createMockEnv('草稿');
    env.store.compactRunning = true;

    handleKey(env, { type: 'ctrl+c' });

    expect(env.abortCompact).toHaveBeenCalledTimes(1);
    expect(env.store.input).toBe('草稿');
    expect(env.exitApp).not.toHaveBeenCalled();
  });

  it('Esc during a running compaction cancels it', () => {
    const { env } = createMockEnv();
    env.store.compactRunning = true;

    handleKey(env, { type: 'esc' });

    expect(env.abortCompact).toHaveBeenCalledTimes(1);
  });

  it('leaves compaction keys inert when nothing is compacting', () => {
    const { env } = createMockEnv();

    handleKey(env, { type: 'esc' });

    expect(env.abortCompact).not.toHaveBeenCalled();
  });
});

describe('TUI Key Handling: startup mode selector', () => {
  it('up/down/wheel move, Enter confirms, Esc dismisses while the selector is active', () => {
    const { env } = createMockEnv();
    env.store.modeSelect = { index: 0 };

    handleKey(env, { type: 'down' });
    expect(env.modeSelectMove).toHaveBeenLastCalledWith(1);
    handleKey(env, { type: 'wheelup' });
    expect(env.modeSelectMove).toHaveBeenLastCalledWith(-1);
    handleKey(env, { type: 'enter' });
    expect(env.modeSelectConfirm).toHaveBeenCalledTimes(1);
    env.store.modeSelect = { index: 2 };
    handleKey(env, { type: 'esc' });
    expect(env.modeSelectDismiss).toHaveBeenCalledTimes(1);
  });

  it('Enter with a typed message collapses the selector and SUBMITS instead of confirming', () => {
    const { env, state } = createMockEnv('帮我写个脚本');
    env.store.modeSelect = { index: 0 };

    handleKey(env, { type: 'enter' });

    expect(env.modeSelectDismiss).toHaveBeenCalledTimes(1);
    expect(env.modeSelectConfirm).not.toHaveBeenCalled();
    expect(state.submitted).toBe(true);
  });

  it('typing falls straight through to the composer (selector never eats letters)', () => {
    const { env, state } = createMockEnv();
    env.store.modeSelect = { index: 0 };

    handleKey(env, { type: 'char', ch: '1' });
    handleKey(env, { type: 'char', ch: 'a' });

    expect(env.store.input).toBe('1a');
    expect(env.modeSelectConfirm).not.toHaveBeenCalled();
    expect(state.submitted).toBe(false);
  });

  it('selector inactive: keys behave as before', () => {
    const { env } = createMockEnv();
    handleKey(env, { type: 'up' });
    expect(env.modeSelectMove).not.toHaveBeenCalled();
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
    store.frameMap = { rows: [{ block, start: 0, count: 1 }], sliceStart: 0, historyRows: 1, topPad: 0 };

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
    store.frameMap = { rows: [{ block, start: 0, count: 1 }], sliceStart: 0, historyRows: 1, topPad: 0 };

    handleKey(env, { type: 'click', y: 1 });
    expect(block.lines).toEqual(['plain row']);
  });
});

describe('click-to-cycle tool fold (tri-state, M10 组件3)', () => {
  function foldBlock() {
    const { env } = createMockEnv();
    const block = {
      lines: ['HEAD'],
      wrapped: undefined,
      fold: { base: ['HEAD'], preview: ['P1', 'MORE'], full: ['P1', 'P2', 'P3'], state: 0 as 0 | 1 | 2 },
    };
    env.store.blocks.push(block);
    env.store.frameMap = { rows: [{ block, start: 0, count: 1 }], sliceStart: 0, historyRows: 1, topPad: 0 };
    return { env, block };
  }

  it('cycles Collapsed → Truncated → Expanded → Collapsed', () => {
    const { env, block } = foldBlock();
    handleKey(env, { type: 'click', y: 1 });
    expect(block.lines).toEqual(['HEAD', 'P1', 'MORE']);
    handleKey(env, { type: 'click', y: 1 });
    expect(block.lines).toEqual(['HEAD', 'P1', 'P2', 'P3']);
    handleKey(env, { type: 'click', y: 1 });
    expect(block.lines).toEqual(['HEAD']);
    expect(block.fold!.state).toBe(0);
  });

  it('detail wins when a block somehow carries both', () => {
    const { env, block } = foldBlock();
    block.detail = { lines: ['D1'], secs: 1, base: ['HEAD'] };
    handleKey(env, { type: 'click', y: 1 });
    expect(block.lines).toEqual(['HEAD', 'D1']);
    expect(block.fold!.state).toBe(0);
  });
});

describe('gauge hover morph (M10 组件1)', () => {
  it('mousemove over the status zone flips gaugeHover; unchanged state costs no render', () => {
    const { env } = createMockEnv();
    env.store.statusZone = { y: 24, gaugeEnd: 18 };
    handleKey(env, { type: 'mousemove', x: 5, y: 24 });
    expect(env.store.gaugeHover).toBe(true);
    handleKey(env, { type: 'mousemove', x: 30, y: 24 }); // 仪表段右侧
    expect(env.store.gaugeHover).toBe(false);
    handleKey(env, { type: 'mousemove', x: 5, y: 10 }); // 别的行
    expect(env.store.gaugeHover).toBe(false);
    const scheduled = vi.mocked(env.scheduleRender).mock.calls.length;
    handleKey(env, { type: 'mousemove', x: 6, y: 10 });
    expect(vi.mocked(env.scheduleRender).mock.calls.length).toBe(scheduled);
    handleKey(env, { type: 'mousemove', x: 7, y: 24 });
    expect(env.store.gaugeHover).toBe(true);
    expect(vi.mocked(env.scheduleRender).mock.calls.length).toBe(scheduled + 1);
  });

  it('mousemove is always consumed — never leaks to the composer', () => {
    const { env } = createMockEnv('keep');
    handleKey(env, { type: 'mousemove', x: 5, y: 5 });
    expect(env.store.input).toBe('keep');
    expect(env.store.gaugeHover).toBe(false);
  });
});

describe('approval always-scope adjustment (M10 组件6)', () => {
  function withApproval(command: string): { env: KeyEnv; answers: AskResult[] } {
    const { env } = createMockEnv();
    const answers: AskResult[] = [];
    env.store.approval = {
      call: { id: 'c1', name: 'bash', args: { command }, rawArgs: JSON.stringify({ command }) },
      kind: 'execute',
      resolve: (a) => {
        answers.push(a);
      },
    };
    env.store.approvalIndex = 1; // 「总是允许」行
    return { env, answers };
  }

  it('←/→ on the always row walks the scope within [1, 命令词数]', () => {
    const { env } = withApproval('git status -sb extra');
    handleKey(env, { type: 'right' });
    expect(env.store.approvalScope).toBe(2);
    handleKey(env, { type: 'right' });
    handleKey(env, { type: 'right' });
    expect(env.store.approvalScope).toBe(4);
    handleKey(env, { type: 'right' }); // 封顶在词数
    expect(env.store.approvalScope).toBe(4);
    handleKey(env, { type: 'left' });
    expect(env.store.approvalScope).toBe(3);
    handleKey(env, { type: 'left' });
    handleKey(env, { type: 'left' });
    expect(env.store.approvalScope).toBe(1); // 触底不再减
    handleKey(env, { type: 'left' });
    expect(env.store.approvalScope).toBe(1);
  });

  it('off the always row, or a compound command, ←/→ moves nothing', () => {
    const { env } = withApproval('git status');
    env.store.approvalIndex = 0;
    handleKey(env, { type: 'right' });
    expect(env.store.approvalScope).toBe(1);
    expect(env.store.approvalIndex).toBe(0); // 不被 composer 层挪光标
    const { env: comp } = withApproval('cd x && ls'); // 复合命令：无词前缀可调
    handleKey(comp, { type: 'right' });
    expect(comp.store.approvalScope).toBe(1);
  });

  it('Enter/a carry the scope only when N>1; N=1 resolves plain always', () => {
    const a = withApproval('git status -sb');
    handleKey(a.env, { type: 'right' });
    handleKey(a.env, { type: 'enter' });
    expect(a.answers).toEqual([{ answer: 'always', scopeWords: 2 }]);
    expect(a.env.store.approval).toBeUndefined();

    const b = withApproval('git status -sb');
    handleKey(b.env, { type: 'enter' });
    expect(b.answers).toEqual(['always']);

    const c = withApproval('git status -sb');
    handleKey(c.env, { type: 'right' });
    handleKey(c.env, { type: 'char', ch: 'a' });
    expect(c.answers).toEqual([{ answer: 'always', scopeWords: 2 }]);
  });

  it('deny/allow paths never mint a grant', () => {
    const { env, answers } = withApproval('git status -sb');
    handleKey(env, { type: 'right' });
    handleKey(env, { type: 'esc' });
    expect(answers).toEqual(['deny']);
  });
});

describe('reject-to-followup & digit fast-select (M10 组件7)', () => {
  function withDenyRow(): { env: KeyEnv; answers: AskResult[] } {
    const { env } = createMockEnv();
    const answers: AskResult[] = [];
    env.store.approval = {
      call: { id: 'c1', name: 'bash', args: { command: 'git status' }, rawArgs: '{}' },
      kind: 'execute',
      resolve: (a) => {
        answers.push(a);
      },
    };
    env.store.approvalIndex = 2; // 拒绝行
    return { env, answers };
  }

  it('拒绝行打字进理由缓冲；⌫ 删字；Enter 携理由 deny', () => {
    const { env, answers } = withDenyRow();
    handleKey(env, { type: 'char', ch: 'n' }); // n 在拒绝行是文字，不是快捷拒绝
    handleKey(env, { type: 'char', ch: 'o' });
    handleKey(env, { type: 'char', ch: ' ' });
    handleKey(env, { type: 'char', ch: 'z' });
    handleKey(env, { type: 'paste', text: 'ignored' }); // 粘贴不进缓冲（v1 只收逐字）
    handleKey(env, { type: 'backspace' });
    expect(env.store.approvalNote).toBe('no ');
    expect(answers).toHaveLength(0);
    handleKey(env, { type: 'enter' });
    expect(answers).toEqual([{ answer: 'deny', reason: 'no ' }]);
    expect(env.store.approval).toBeUndefined();
  });

  it('y/a 快捷批准在拒绝行仍然有效；Esc 丢弃缓冲直接拒绝', () => {
    const a = withDenyRow();
    handleKey(a.env, { type: 'char', ch: 'x' });
    handleKey(a.env, { type: 'char', ch: 'y' });
    expect(a.answers).toEqual(['allow']);

    const b = withDenyRow();
    handleKey(b.env, { type: 'char', ch: 'x' });
    handleKey(b.env, { type: 'esc' });
    expect(b.answers).toEqual(['deny']); // Esc 不带理由
    expect(b.env.store.approvalNote).toBe('x'); // 缓冲随弹窗作废
  });

  it('空理由 Enter 走普通 deny；离开拒绝行后打字不再进缓冲', () => {
    const a = withDenyRow();
    handleKey(a.env, { type: 'enter' });
    expect(a.answers).toEqual(['deny']);

    const b = withDenyRow();
    b.env.store.approvalIndex = 0;
    handleKey(b.env, { type: 'char', ch: 'z' }); // 非拒绝行的 z 不是 y/a/n/1-3 → 吞掉无效果
    expect(b.env.store.approvalNote).toBe('');
    expect(b.answers).toHaveLength(0);
  });

  it("model/session picker: '1'-'9' 直达对应行，越界数字不动作", () => {
    const { env } = createMockEnv();
    env.store.modelPicker = { models: ['m-a', 'm-b', 'm-c'], index: 0 };
    handleKey(env, { type: 'char', ch: '3' });
    expect(env.store.modelPicker.index).toBe(2);
    handleKey(env, { type: 'char', ch: '9' }); // 只有 3 个模型——越界不挪
    expect(env.store.modelPicker.index).toBe(2);

    const { env: e2 } = createMockEnv();
    e2.store.sessionPicker = {
      entries: [
        { file: 'a.jsonl', id: 'a', mtime: 1, createdAt: 1, title: 'a' },
        { file: 'b.jsonl', id: 'b', mtime: 2, createdAt: 2, title: 'b' },
      ],
      index: 0,
    };
    handleKey(e2, { type: 'char', ch: '2' });
    expect(e2.store.sessionPicker.index).toBe(1);
  });
});

describe('composer paste chips (M10 组件8)', () => {
  const pasted = 'log line one\nline two\nline three';

  it('多行粘贴：全文入缓冲、chip 罩住粘贴段、光标落在右界', () => {
    const { env } = createMockEnv('看这段：');
    handleKey(env, { type: 'paste', text: pasted });
    expect(env.store.input).toBe(`看这段：${pasted}`);
    expect(env.store.inputChips).toEqual([{ start: 4, end: 4 + pasted.length }]);
    expect(env.store.cursorPos).toBe(env.store.input.length);
  });

  it('短粘贴（无换行）不成 chip；提交路径看到的永远是全文', () => {
    const { env } = createMockEnv();
    handleKey(env, { type: 'paste', text: 'one line paste' });
    expect(env.store.inputChips).toHaveLength(0);
    expect(env.store.input).toBe('one line paste');
  });

  it('←/→ 跨 chip 整越：光标恒不进入内部', () => {
    const { env } = createMockEnv('');
    handleKey(env, { type: 'paste', text: pasted });
    handleKey(env, { type: 'left' });
    expect(env.store.cursorPos).toBe(0); // chip.start===0 → 弹回左界
    handleKey(env, { type: 'right' });
    expect(env.store.cursorPos).toBe(pasted.length); // 整越到右界
  });

  it('chip 右缘退格先展开（文字还原可见），再按才真删', () => {
    const { env } = createMockEnv();
    handleKey(env, { type: 'paste', text: pasted });
    handleKey(env, { type: 'backspace' });
    expect(env.store.inputChips).toHaveLength(0); // 展开
    expect(env.store.input).toBe(pasted); // 文字未损
    expect(env.store.cursorPos).toBe(pasted.length);
    handleKey(env, { type: 'backspace' });
    expect(env.store.input).toBe(pasted.slice(0, -1)); // 第二下才删
  });

  it('chip 前打字：区间整体后移；setInputAll 连 chip 一起作废', () => {
    const { env } = createMockEnv();
    handleKey(env, { type: 'paste', text: pasted });
    handleKey(env, { type: 'left' }); // 弹到 chip.start===0
    handleKey(env, { type: 'char', ch: 'x' });
    expect(env.store.inputChips).toEqual([{ start: 1, end: 1 + pasted.length }]);
    env.store.setInputAll('');
    expect(env.store.inputChips).toHaveLength(0);
  });

  it('ctrl+u 从 chip 左界吞前无物；从 chip 右界整删 chip（相交溶解）', () => {
    const { env } = createMockEnv('pre-');
    handleKey(env, { type: 'paste', text: pasted });
    handleKey(env, { type: 'ctrl+u' }); // 光标在 chip.end，编辑区 [0,cursor) 罩住 chip → 溶解
    expect(env.store.inputChips).toHaveLength(0);
    expect(env.store.input).toBe('');
    expect(env.store.cursorPos).toBe(0);
  });
});
