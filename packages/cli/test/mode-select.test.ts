import { describe, expect, it } from 'vitest';
import { plainPalette } from '@nova-agent/tui-view';
import { codeRuntimeAvailable } from '@nova-agent/plugins';
import type { PtcMode } from '@nova-agent/core';
import { TuiStore } from '../src/tui/store.js';
import { CODE_MODE_ORDER, ModeSelector } from '../src/tui/mode-select.js';

/** 假宿主：setCodeMode 恒成功并回写当前模式；卡片整块投影全在真实 TuiStore 上。 */
function setup(initial: PtcMode = 'native') {
  const store = new TuiStore(() => undefined);
  let codeMode: PtcMode = initial;
  const setCalls: PtcMode[] = [];
  let renders = 0;
  const selector = new ModeSelector({
    store,
    paint: () => plainPalette,
    cols: () => 100,
    codeMode: () => codeMode,
    info: () => ({
      rootDir: 'D:/work/demo',
      sessionsRoot: '/home/me/.nova/sessions',
      home: '/home/me',
      version: '1.2.3',
      skills: [],
      warnings: [],
    }),
    setCodeMode: async (next) => {
      setCalls.push(next);
      codeMode = next;
      return true;
    },
    render: () => {
      renders += 1;
    },
  });
  return { store, selector, setCalls, current: () => codeMode, renderCount: () => renders };
}

/** 卡片行数（顶框 + 工作区/会话/模式/沙箱 + 底框）。 */
const CARD_ROWS = 6;

describe('ModeSelector', () => {
  it('show mounts the welcome card with the picker on the current mode', () => {
    const t = setup('ptc');
    t.selector.show();
    expect(t.store.modeSelect?.index).toBe(CODE_MODE_ORDER.indexOf('ptc'));
    expect(t.store.blocks).toHaveLength(1);
    const card = t.store.blocks[0]!.lines.join('\n');
    expect(card).toContain('╭');
    expect(card).toContain('[ •PTC ]'); // 光标胶囊，且它就是已生效档位（带点）
    expect(card).toContain('当前模式');
  });

  it('move cycles the selection and rewrites the block in place (no new blocks)', () => {
    const t = setup('native');
    t.selector.show();
    const before = t.store.blocks[0]!;
    t.selector.move(1);
    expect(t.store.modeSelect?.index).toBe(1);
    expect(t.store.blocks).toHaveLength(1);
    expect(t.store.blocks[0]).toBe(before);
  });

  it('confirm switches mode through the shared setCodeMode gate and collapses in place', async () => {
    const t = setup('native');
    t.selector.show();
    t.selector.move(1);
    await t.selector.confirm();
    expect(t.setCalls).toEqual(['ptc']);
    expect(t.store.modeSelect).toBeUndefined();
    // 原位换形：同一块仍是同一块，只是模式行退回静态形态（交互残骸为零）。
    expect(t.store.blocks).toHaveLength(1);
    expect(t.store.blocks[0]!.lines).toHaveLength(CARD_ROWS);
    const card = t.store.blocks[0]!.lines.join('\n');
    expect(card).toContain('Tab 可随时切换');
    expect(card).not.toContain('↑↓');
    expect(t.renderCount()).toBe(1);
  });

  it('dismiss keeps the current mode and collapses without a setCodeMode call', () => {
    const t = setup('both');
    t.selector.show();
    t.selector.dismiss();
    expect(t.setCalls).toEqual([]);
    expect(t.store.modeSelect).toBeUndefined();
    expect(t.store.blocks[0]!.lines).toHaveLength(CARD_ROWS);
  });

  it('reset (clear / session switch) drops the block reference without collapsing', () => {
    const t = setup('native');
    t.selector.show();
    t.selector.reset();
    expect(t.store.modeSelect).toBeUndefined();
    // reset 后 collapse 不再改写任何块。
    const linesBefore = t.store.blocks[0]!.lines.length;
    t.selector.collapse();
    expect(t.store.blocks[0]!.lines.length).toBe(linesBefore);
  });

  it('confirm on the already-current mode does not rebuild the host', async () => {
    const t = setup('native');
    t.selector.show();
    // 显式点选第 0 行（native）：与当前相同 → 不派发 setCodeMode，仅塌缩。
    await t.selector.confirm(0);
    expect(t.setCalls).toEqual([]);
    expect(t.store.modeSelect).toBeUndefined();
  });

  it('PTC-unavailable hosts keep native as the only landing spot for moves', () => {
    // 本测试环境不固定 Node 版本：只在确实不支持类型剥离时钉跳过语义。
    if (codeRuntimeAvailable()) return;
    const t = setup('native');
    t.selector.show();
    t.selector.move(1);
    expect(t.store.modeSelect?.index).toBe(0);
  });
});
