/**
 * 开屏执行模式选择器的状态机（阶段 E 出壳）：welcome 卡片整块归它所有——
 * 挂载、↑↓/滚轮移动、Enter 确认（走 Tab 同一 setCodeMode 门）、Esc 保持当前，
 * 以及**原位塌缩**（同一块换回无选择器形态，不在转录里留交互残骸）。
 * 行构造纯函数在 tui-view/splash.ts（buildWelcome/nextModeIndex）。
 */
import type { PtcMode } from '@nova-agent/core';
import { codeRuntimeAvailable } from '@nova-agent/plugins';
import { buildWelcome, nextModeIndex, type Palette, type WelcomeInfo } from '@nova-agent/tui-view';
import type { Block, TuiStore } from './store.js';

/** 卡片内容（`cols` 由选择器按当前终端宽度补）。 */
type WelcomeContent = Omit<WelcomeInfo, 'cols'>;

/** Tab 与选择器共用的模式循环序（native → PTC → 混合 → native…）。 */
export const CODE_MODE_ORDER: PtcMode[] = ['native', 'ptc', 'both'];

export interface ModeSelectorDeps {
  store: TuiStore;
  paint(): Palette;
  cols(): number;
  codeMode(): PtcMode;
  /** 卡片内容快照：工作区/技能会随 applyWorkspace 重指，一律取活值。 */
  info(): WelcomeContent;
  /** 与 Tab 同一入口：false = Node 太旧拒绝或宿主重建失败（选择块留存再选）。 */
  setCodeMode(next: PtcMode): Promise<boolean>;
  render(): void;
}

export class ModeSelector {
  private block: Block | undefined;

  constructor(private readonly deps: ModeSelectorDeps) {}

  /** 整块卡片：选择器在架时带分段控件行，塌缩后同块换回静态形态。 */
  private rows(index?: number): string[] {
    const d = this.deps;
    const select = index === undefined ? undefined : { index, ptcAvailable: codeRuntimeAvailable() };
    return buildWelcome(d.paint(), {
      ...d.info(),
      cols: d.cols(),
      codeMode: d.codeMode(),
      ...(select !== undefined ? { select } : {}),
    });
  }

  /** 开屏后挂载卡片，初始选中当前模式。 */
  show(): void {
    const d = this.deps;
    const index = Math.max(0, CODE_MODE_ORDER.indexOf(d.codeMode()));
    this.block = d.store.pushBlock(this.rows(index));
    d.store.modeSelect = { index };
  }

  /** 卡片仍在转录里（可能被 /clear/会话切换清掉）。 */
  private alive(): boolean {
    return this.block !== undefined && this.deps.store.blocks.includes(this.block);
  }

  /** 原位换回静态卡片（首条提交/确认/放弃都走这里）。 */
  collapse(): void {
    const d = this.deps;
    if (d.store.modeSelect === undefined) return;
    d.store.modeSelect = undefined;
    if (this.alive()) d.store.replaceBlock(this.block!, this.rows());
    this.block = undefined;
  }

  /** 外部清场（/clear、会话切换）：只丢块引用，不塌缩出静态卡片。 */
  reset(): void {
    this.block = undefined;
    this.deps.store.modeSelect = undefined;
  }

  move(delta: number): void {
    const d = this.deps;
    if (d.store.modeSelect === undefined) return;
    d.store.modeSelect.index = nextModeIndex(d.store.modeSelect.index, delta, codeRuntimeAvailable());
    if (this.alive()) {
      d.store.replaceBlock(this.block!, this.rows(d.store.modeSelect.index));
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
