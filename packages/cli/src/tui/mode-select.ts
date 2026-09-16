/**
 * 开屏执行模式选择器的状态机（阶段 E 出壳）：交互式选择块的挂载、↑↓/滚轮
 * 移动、Enter 确认（走 Tab 同一 setCodeMode 门）、Esc 保持当前，以及**原位
 * 塌缩**（选择块改写为确认行，不在转录里留交互残骸）。行构造纯函数在
 * tui-view/splash.ts（modeSelectRows/modeSelectedRow/nextModeIndex）。
 */
import type { PtcMode } from '@nova-agent/core';
import { codeRuntimeAvailable } from '@nova-agent/plugins';
import { modeSelectedRow, modeSelectRows, nextModeIndex, type Palette } from '@nova-agent/tui-view';
import type { Block, TuiStore } from './store.js';

/** Tab 与选择器共用的模式循环序（native → PTC → 混合 → native…）。 */
export const CODE_MODE_ORDER: PtcMode[] = ['native', 'ptc', 'both'];

export interface ModeSelectorDeps {
  store: TuiStore;
  paint(): Palette;
  cols(): number;
  codeMode(): PtcMode;
  /** 与 Tab 同一入口：false = Node 太旧拒绝或宿主重建失败（选择块留存再选）。 */
  setCodeMode(next: PtcMode): Promise<boolean>;
  render(): void;
}

export class ModeSelector {
  private block: Block | undefined;

  constructor(private readonly deps: ModeSelectorDeps) {}

  /** 开屏后挂载选择块，初始选中当前模式。 */
  show(): void {
    const d = this.deps;
    const index = Math.max(0, CODE_MODE_ORDER.indexOf(d.codeMode()));
    this.block = d.store.pushBlock(
      modeSelectRows(d.paint(), { index, ptcAvailable: codeRuntimeAvailable(), cols: d.cols() }),
    );
    d.store.modeSelect = { index };
  }

  /** 选择块仍在转录里（可能被 /clear/会话切换清掉）。 */
  private alive(): boolean {
    return this.block !== undefined && this.deps.store.blocks.includes(this.block);
  }

  /** 原位塌缩成确认行（首条提交/确认/放弃都走这里）。 */
  collapse(): void {
    const d = this.deps;
    if (d.store.modeSelect === undefined) return;
    d.store.modeSelect = undefined;
    if (this.alive()) {
      d.store.replaceBlock(this.block!, [modeSelectedRow(d.paint(), d.codeMode(), d.cols())]);
    }
    this.block = undefined;
  }

  /** 外部清场（/clear、会话切换）：只丢块引用，不塌缩出确认行。 */
  reset(): void {
    this.block = undefined;
    this.deps.store.modeSelect = undefined;
  }

  move(delta: number): void {
    const d = this.deps;
    if (d.store.modeSelect === undefined) return;
    d.store.modeSelect.index = nextModeIndex(d.store.modeSelect.index, delta, codeRuntimeAvailable());
    if (this.alive() && d.store.modeSelect !== undefined) {
      d.store.replaceBlock(
        this.block!,
        modeSelectRows(d.paint(), { index: d.store.modeSelect.index, ptcAvailable: codeRuntimeAvailable(), cols: d.cols() }),
      );
    }
  }

  async confirm(index?: number): Promise<void> {
    const d = this.deps;
    if (d.store.modeSelect === undefined) return;
    const next = CODE_MODE_ORDER[index ?? d.store.modeSelect.index] ?? d.codeMode();
    if (next !== d.codeMode()) {
      const ok = await d.setCodeMode(next);
      if (!ok) {
        // warning line already pushed; selector stays for another pick
        this.move(0);
        return;
      }
    }
    this.collapse();
    d.render();
  }

  dismiss(): void {
    this.collapse();
    this.deps.render();
  }
}
