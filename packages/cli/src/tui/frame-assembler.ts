/**
 * 整帧装配（阶段 E 出壳 tui-mode）：弹窗选择 → composer/队列 → 展平缓存 →
 * 滚动锚定 → 历史切片 → 状态栏裁剪 → 呼吸行位置指示 → 交给 LineScreen。
 * 三个可变缓冲（展平缓存、上帧行数、上下文仪表缓存）都收敛在类里——此前
 * 散在壳层闭包，属于"只能在真机截图里发现"的那类状态。
 */
import type { PtcMode, Usage } from '@nova-agent/core';
import {
  BREATHE_ROWS,
  COMPOSER_MAX_ROWS,
  STATUS_ROWS,
  bottomStack,
  clipToWidth,
  composerWrapBudget,
  composerZone,
  cursorPosition,
  layoutComposer,
  messageQueueRows,
  type Palette,
} from '@nova-agent/tui-view';
import {
  contextBreakdown,
  contextGaugeForms,
  gaugeCacheKey,
  statusBar,
  type ContextBreakdownView,
  type StatusView,
} from '../statusbar.js';
import { flattenBlocks, sliceHistory, type ActiveViewDeps } from './frame.js';
import type { Block, TuiStore } from './store.js';

/** 展平结果缓存（按 cols + blocksVersion 失效）；重算要重跑全部 wrapBlock。 */
type FlattenCache = {
  cols: number;
  version: number;
  result: { flat: string[]; rowMap: { block: Block; start: number; count: number }[] };
};

export interface FrameAssemblerDeps {
  store: TuiStore;
  paint(): Palette;
  cols(): number;
  rows(): number;
  activeView(deps: ActiveViewDeps, cols: number): string[];
  /** 状态栏帧快照（含上下文仪表三档形态）。 */
  statusView(): StatusView;
  /** 上下文分解快照（仪表缓存与 /session 明细共用一份读数）。 */
  contextView(): ContextBreakdownView;
  /** 仪表缓存键的分量（任一变化即重算三档形态；见 gaugeCacheKey）。 */
  gaugeKeyParts(): {
    messagesLen: number;
    usageAnchor: Usage | undefined;
    model: string;
    codeMode: PtcMode;
    modelMetaVersion: number;
    capacity: number | undefined;
    toolCount: number;
    compactLimit: number | undefined;
  };
  write(lines: string[], cursor: { row: number; col: number }): void;
}

export class FrameAssembler {
  private cachedFlatten: FlattenCache | undefined;
  /** 上一帧展平后的总行数（滚动锚定的增量基准；-1 = 尚无帧）。 */
  private lastFlatLen = -1;
  private contextLineCache: { key: string; lines: [string, string, string] } | undefined;

  constructor(private readonly deps: FrameAssemblerDeps) {}

  /**
   * 上下文仪表段（三档形态一次算全，按 key 缓存）：分段明细在 `/session`，
   * 这里按档位给出 全量/去冗/最简 三种形态供状态栏选档。容量取 models.dev
   * 元数据（config.provider.contextWindow 兜底），条严格按整窗比例分摊。
   * 缓存必要：重算要对 messages 全量估算，每 tick 一遍是性能雷区。
   */
  gaugeForms(): [string, string, string] {
    const d = this.deps;
    const parts = d.gaugeKeyParts();
    const cols = d.cols();
    const key = gaugeCacheKey({
      messagesLen: parts.messagesLen,
      usageAnchor: parts.usageAnchor,
      model: parts.model,
      codeMode: parts.codeMode,
      modelMetaVersion: parts.modelMetaVersion,
      capacity: parts.capacity,
      toolCount: parts.toolCount,
      compactLimit: parts.compactLimit,
      cols,
    });
    if (this.contextLineCache === undefined || this.contextLineCache.key !== key) {
      const { segments, used, capacity } = contextBreakdown(d.contextView());
      this.contextLineCache = {
        key,
        lines: contextGaugeForms(d.paint(), { segments, used, capacity, compact: parts.compactLimit }, cols),
      };
    }
    return this.contextLineCache.lines;
  }

  /** 一帧（弹窗 → composer → 历史 → 状态栏 → 呼吸行）。 */
  render(activeViewDeps: ActiveViewDeps): void {
    const d = this.deps;
    const store = d.store;
    const paint = d.paint();
    const cols = d.cols();
    const rows = d.rows();

    const popupLines = d.activeView(activeViewDeps, cols);

    // One breathing row between the newest content and the composer.
    const layout = layoutComposer(store.input, store.cursorPos, composerWrapBudget(cols), COMPOSER_MAX_ROWS);
    const composerZoneRows = composerZone(paint, layout, {
      spinnerFrame: store.spinnerFrame,
      streaming: store.streaming,
      genPhase: store.genPhase,
    });
    // 运行中排队的消息：composer 上方的暗色 lane，始终可见（消息队列语义）。
    const queueLines = messageQueueRows(paint, store.messageQueue, cols);
    if (this.cachedFlatten === undefined || this.cachedFlatten.cols !== cols || this.cachedFlatten.version !== store.blocksVersion) {
      this.cachedFlatten = { cols, version: store.blocksVersion, result: flattenBlocks(store.blocks, cols) };
    }
    const { flat, rowMap } = this.cachedFlatten.result;
    // 滚动锚定（stick-to-content）：用户上滚后（scrollFromEnd>0）新输出
    // 不再把视口往直播拽——按上一帧以来的新增行数等量增大 offset，把视口
    // 钉在用户当时看的绝对位置；回到底部（offset 归 0）后恢复跟随。
    if (store.scrollFromEnd > 0 && this.lastFlatLen >= 0 && flat.length > this.lastFlatLen) {
      store.scrollFromEnd += flat.length - this.lastFlatLen;
    }
    this.lastFlatLen = flat.length;
    const historyBudget = rows - popupLines.length - queueLines.length - composerZoneRows.length - STATUS_ROWS - BREATHE_ROWS;
    const { lines: historyLines, sliceStart, maxScroll } = sliceHistory(flat, historyBudget, store.scrollFromEnd);
    if (store.scrollFromEnd > maxScroll) store.scrollFromEnd = maxScroll;
    store.frameMap = { rows: rowMap, sliceStart, historyRows: historyLines.length };

    // 按显示宽裁剪：绝不折行顶动布局（statusBar 内部已做截左保右）。
    const status = clipToWidth(statusBar(paint, this.deps.statusView()), cols - 1);

    // 位置指示：上滚时呼吸行改为「上方还有 N 行」（回底自动消失；不占内容行、
    // 不进状态栏——上滚不进状态栏是 tui-design 红线）。
    const breathText =
      sliceStart > 0
        ? clipToWidth(paint.dim(`  ⋯ 上方还有 ${sliceStart} 行 · Home 跳顶 / End 回到底部`), cols - 1)
        : '';

    d.write(
      bottomStack(historyLines, popupLines, queueLines, composerZoneRows, status, breathText),
      cursorPosition({ historyRows: historyLines.length, popupRows: popupLines.length, queueRows: queueLines.length, layout }),
    );
  }

  /** 终端尺寸变化：丢弃展平缓存（wrapBlock 缓存另经 invalidateWraps）。 */
  invalidate(): void {
    this.cachedFlatten = undefined;
  }
}