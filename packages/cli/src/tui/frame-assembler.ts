/**
 * 整帧装配（阶段 E 出壳 tui-mode）：弹窗选择 → composer/队列 → 增量展平 →
 * 逻辑滚动锚 → 历史切片 → 状态栏裁剪 → 呼吸行位置指示 → 交给 LineScreen。
 * 可变缓冲（展平器、滚动锚、上下文仪表缓存）都收敛在类里——此前
 * 散在壳层闭包，属于"只能在真机截图里发现"的那类状态。
 */
import type { PtcMode, Usage } from '@nova-agent/core';
import {
  BREATHE_ROWS,
  COMPOSER_MAX_ROWS,
  COMPOSER_PLACEHOLDER,
  HISTORY_MIN_ROWS,
  HINT_ROWS,
  STATUS_ROWS,
  bottomStack,
  clipToWidth,
  composerCard,
  composerCardWidth,
  composerInfo,
  composerWrapBudget,
  cursorPosition,
  foldChips,
  hintBar,
  hintItems,
  layoutComposer,
  messageQueueRows,
  type Palette,
} from '@nova-agent/tui-view';
import {
  contextBreakdown,
  contextGaugeForms,
  gaugeCacheKey,
  gaugeHitWidth,
  statusBar,
  type ContextBreakdownView,
  type StatusView,
} from '@nova-agent/tui-view';
import { Flattener, sliceHistory, type ActiveViewDeps } from './frame.js';
import type { Block, TuiStore } from './store.js';

export interface FrameAssemblerDeps {
  store: TuiStore;
  paint(): Palette;
  cols(): number;
  rows(): number;
  activeView(deps: ActiveViewDeps, cols: number): string[];
  /** 状态栏帧快照（含上下文仪表三档形态）。 */
  statusView(): StatusView;
  /** 快捷键条用：Tab 此刻是否真能切执行模式（壳层 canSwitchMode 的活值访问器）。 */
  tabMode(): boolean;
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
  /** 增量展平器（M10 R4）：脏起点前缀复用，替代旧的版本键全量缓存。 */
  private readonly flattener = new Flattener();
  /**
   * 逻辑滚动锚（M10 R5，Grok 双锚简化）：视口顶行所钉的块 + 相对该块起始
   * 行的偏移（可为负=块前的分隔空行，或等于行数=块后的分隔空行）。每帧由
   * 锚反推行偏移，历史任意处增删行视口都不漂移。undefined = 贴底直播。
   */
  private anchor: { block: Block; rowInBlock: number } | undefined;
  /** 上帧渲染定稿后的 scrollFromEnd——与本帧入口值不等 = 用户滚过，让位。 */
  private lastScroll = 0;
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
      hover: d.store.gaugeHover,
    });
    if (this.contextLineCache === undefined || this.contextLineCache.key !== key) {
      const { segments, used, capacity } = contextBreakdown(d.contextView());
      this.contextLineCache = {
        key,
        lines: contextGaugeForms(
          d.paint(),
          { segments, used, capacity, compact: parts.compactLimit },
          cols,
          d.store.gaugeHover,
        ),
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
    // 组件8：粘贴 chip 纯显示折叠——layout 走折叠面文本，光标位置先映射。
    // 输入区是圆角卡片（Grok prompt）：左右内衬 2 + 上下边框，正文宽连边框一起扣。
    const chipFold = foldChips(store.input, store.inputChips);
    const wrapBudget = composerWrapBudget(composerCardWidth(cols) - 2);
    const layout = layoutComposer(chipFold.text, chipFold.toDisplay(store.cursorPos), wrapBudget, COMPOSER_MAX_ROWS);
    // 占位行只说"在这里输入"——键位归屏幕最后一行的快捷键条（设计语言里的分工）。
    const placeholder =
      chipFold.text === '' && !store.streaming && popupLines.length === 0 ? COMPOSER_PLACEHOLDER : '';
    const composerZoneRows = composerCard(paint, layout, {
      spinnerFrame: store.spinnerFrame,
      streaming: store.streaming,
      genPhase: store.genPhase,
      cols,
      info: composerInfo({
        rows: layout.totalRows,
        cursorRow: layout.cursorRow,
        chars: [...store.input].length,
        queued: store.messageQueue.length,
      }),
      placeholder,
    });
    // 运行中排队的消息：composer 上方的暗色 lane，始终可见（消息队列语义）。
    const queueLines = messageQueueRows(paint, store.messageQueue, cols);
    const { flat, rowMap } = this.flattener.flatten(store.blocks, cols);
    const historyBudget =
      rows - popupLines.length - queueLines.length - composerZoneRows.length - STATUS_ROWS - BREATHE_ROWS - HINT_ROWS;
    // 逻辑滚动锚定（M10 R5）：上滚后每帧由锚块在 rowMap 的最新起始行反推
    // scrollFromEnd——尾部追加自动补偿（顶行不变⇒偏移随之增长），历史中段
    // 任意增删行视口也不漂移（旧的「按上帧行数差补偿」只治尾增）。
    // scrollFromEnd 与上帧定稿值不等 = 用户滚过（keys/滚轮/Home/End）：
    // 让位其行数，本帧渲染后按新视口顶重锚。锚块消失（截尾/换会话）则
    // 回落行数语义（结构锚兜底）。
    if (this.anchor !== undefined && store.scrollFromEnd === this.lastScroll) {
      const entry = rowMap.find((e) => e.block === this.anchor!.block);
      if (entry !== undefined) {
        // scrollFromEnd 钉的是切片**底**距内容底的多寡；锚的是顶行——
        // top = len - scroll - rows（与 sliceHistory 同一公式）。
        const visibleRows = Math.max(HISTORY_MIN_ROWS, historyBudget);
        store.scrollFromEnd = Math.max(0, flat.length - entry.start - this.anchor.rowInBlock - visibleRows);
      } else {
        this.anchor = undefined;
      }
    }
    const { lines: historyLines, sliceStart, maxScroll } = sliceHistory(flat, historyBudget, store.scrollFromEnd);
    if (store.scrollFromEnd > maxScroll) store.scrollFromEnd = maxScroll;
    // 开屏垂直锚定（Grok welcome 的 remaining/3）：内容比视口短时，把三分之
    // 一空白挪到顶部——不是居中，居中在终端里读起来像浮在半空。只在贴底且
    // 首轮提交前做——一旦有对话就是文档流，挪动反而像 bug。
    let topPad = 0;
    if (store.welcomeCenter && store.scrollFromEnd === 0) {
      const slack = historyLines.length - flat.length;
      topPad = Math.max(0, Math.floor(slack / 3));
      if (topPad > 0) {
        historyLines.splice(historyLines.length - topPad, topPad);
        for (let i = 0; i < topPad; i++) historyLines.unshift('');
      }
    }
    store.frameMap = { rows: rowMap, sliceStart, historyRows: historyLines.length, topPad };
    // 重锚：贴底不需要锚（恢复直播跟随）；否则钉住视口顶行所在块。
    this.anchor = store.scrollFromEnd === 0 ? undefined : (anchorAt(rowMap, sliceStart) ?? this.anchor);
    this.lastScroll = store.scrollFromEnd;

    // 按显示宽裁剪：绝不折行顶动布局（statusBar 内部已做截左保右）。
    const status = clipToWidth(statusBar(paint, this.deps.statusView()), cols - 1);
    // 仪表 hover 命中区（M10 组件1）：状态栏现在是倒数第二行（底行让给快捷键条），
    // 仪表字段是行首段——命中宽取首个 `│` 前的显示列数，按键链按此翻转 hover。
    store.statusZone = { y: rows - HINT_ROWS, gaugeEnd: gaugeHitWidth(status) };

    // 位置指示：上滚时呼吸行改为「上方还有 N 行」（回底自动消失；不占内容行、
    // 不进状态栏——上滚不进状态栏是 tui-design 红线）。
    const breathText =
      sliceStart > 0
        ? clipToWidth(paint.dim(`  ⋯ 上方还有 ${sliceStart} 行 · Home 跳顶 / End 回到底部`), cols - 1)
        : '';
    // 快捷键条：屏幕最后一行，键位随"谁占用键盘"换一套，超宽从尾部整条丢。
    const hints = clipToWidth(
      hintBar(
        paint,
        hintItems({
          picker: this.hintPicker(store, activeViewDeps),
          modeSelect: store.modeSelect !== undefined,
          streaming: store.streaming || store.compactRunning,
          queue: store.messageQueue.length,
          tabMode: d.tabMode(),
        }),
        cols - 1,
      ),
      cols - 1,
    );

    d.write(
      bottomStack(historyLines, popupLines, queueLines, composerZoneRows, status, breathText, hints),
      cursorPosition({
        historyRows: historyLines.length,
        popupRows: popupLines.length,
        queueRows: queueLines.length,
        leadRows: 1, // 卡片顶框那一行
        layout,
      }),
    );
  }

  /** 键盘被哪个面板占用（决定快捷键条换哪套键位）。 */
  private hintPicker(store: TuiStore, deps: ActiveViewDeps): 'approval' | 'command' | 'model' | 'session' | undefined {
    if (store.approval !== undefined) return 'approval';
    if (store.modelPicker !== undefined) return 'model';
    if (store.sessionPicker !== undefined) return 'session';
    return store.input.startsWith('/') && !store.popupDismissed && deps.commandMatches.length > 0 ? 'command' : undefined;
  }

  /** 终端尺寸变化/换会话：丢弃展平器与滚动锚（wrapBlock 缓存另经 invalidateWraps）。 */
  invalidate(): void {
    this.flattener.reset();
    this.anchor = undefined;
    this.lastScroll = 0;
  }
}

/** 按视口顶绝对行定位锚块：首个行区间覆盖 top 的条目；top 落在块前分隔
 *  空行时 rowInBlock 为负——反推是纯加减法，负值同样精确钉住空行。 */
function anchorAt(
  rowMap: { block: Block; start: number; count: number }[],
  top: number,
): { block: Block; rowInBlock: number } | undefined {
  for (const e of rowMap) {
    if (top < e.start + e.count) return { block: e.block, rowInBlock: top - e.start };
  }
  return undefined;
}