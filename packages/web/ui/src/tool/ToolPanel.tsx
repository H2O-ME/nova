/**
 * The tool detail panel: one call, in full, hanging off the frame's right edge.
 *
 * The transcript row is a summary — a verb, an operand, a verdict. Everything a
 * summary has to leave out lives here: the exact arguments, the complete result
 * text, the call's time, and the structured card drawn WHOLE (the row's row cap
 * does not apply). The panel is deliberately dumb: it receives the block the
 * reducer already holds and shows its fields, so a tool this bundle has never
 * heard of is just as inspectable as bash.
 *
 * The shell (`.panel`, its two presentations, the 28px strip control) is ported
 * from deepseek-harness `ui-sidebar-right/SidebarRight.module.css` (MIT); the
 * frame owns the column geometry and the width preference and passes them in as
 * props, and the shell reports shown/track/fullscreen back through
 * `layout-store.openRightbar`.
 */
import { useMemo } from 'react';
import { toolCardModel, type CardModel } from '../card-view.js';
import { formatClock } from '../format.js';
import { CloseIcon } from '../icons.js';
import { bodyShell, rowSlots, type BodyShell } from './model.js';
import { ExitFullscreenIcon, FullscreenIcon } from './icons.js';
import { CardBody } from './views/CardBody.js';
import type { Block } from '../state.js';
import css from './ToolPanel.module.css';

/** The call's verdict in one word (`row.*` copy plus the settled ok case). */
const STATE_WORDS: Record<CardModel['state'], string> = {
  running: '运行中',
  stale: '已停止',
  fail: '失败',
  ok: '已完成',
};

export interface ToolPanelProps {
  /** The tool block the reducer holds (never a copy the panel re-derives). */
  block: Extract<Block, { kind: 'tool' }>;
  /** Resolved normal panel width in px (AppFrame's rightbar slot parameter). */
  width: number;
  /** The column has a track for the panel; false = the panel takes the frame. */
  canShow: boolean;
  /**
   * Nothing is running. A call with no result yet is only a leftover ("已停止")
   * when the turn is over; while the turn is live it is in flight ("运行中").
   * The panel used to hardcode this to `true`, so an open details board said
   * "已停止" about a call the row behind it was still drawing as running.
   */
  idle: boolean;
  /**
   * Fullscreen presentation. The shell owns the flag (it is what reports
   * shown/track/fullscreen through `layout-store.openRightbar`); the panel only
   * draws it and asks for the toggle.
   */
  fullscreen?: boolean | undefined;
  onClose: () => void;
  onToggleFullscreen: () => void;
  /** Session workspace root, for the terminal banner's prompt label. */
  cwd?: string | undefined;
  /** Host account home, so a cwd equal to it collapses to `~`. */
  home?: string | undefined;
}

/** How the panel presents itself in the frame's right column. */
export type PanelPresentation = 'fullscreen' | 'push' | 'takeover';

export function panelPresentation(fullscreen: boolean, canShow: boolean): PanelPresentation {
  if (fullscreen) return 'fullscreen';
  return canShow ? 'push' : 'takeover';
}

export function ToolPanel({
  block,
  width,
  canShow,
  idle,
  fullscreen = false,
  onClose,
  onToggleFullscreen,
  cwd,
  home,
}: ToolPanelProps): JSX.Element {
  const model = useMemo(
    () => toolCardModel({ name: block.name, args: block.args, view: block.view, result: block.result, idle }),
    [block.name, block.args, block.view, block.result, idle],
  );
  const slots = useMemo(() => rowSlots({ name: block.name, view: block.view, model }), [block.name, block.view, model]);
  const shell = useMemo(
    () =>
      bodyShell({
        view: block.view,
        body: model.body,
        result: block.result,
        model,
        output: block.output,
        tail: block.tail,
        args: block.args,
      }),
    [block.view, model, block.result, block.output, block.tail, block.args],
  );
  const presentation = panelPresentation(fullscreen, canShow);
  const failed = model.state === 'fail';
  const modeLabel = fullscreen ? '退出全屏' : '全屏';
  return (
    <aside
      className={css.panel}
      data-tool-panel={presentation}
      style={presentation === 'push' ? { width } : undefined}
      aria-label={`${block.name} 调用详情`}
    >
      <header className={css.header}>
        <span className={css.identity}>
          <span className={css.name}>{block.name}</span>
          <span className={css.headline} data-mono={model.mono || undefined} title={slots.summary}>
            {model.headline}
          </span>
        </span>
        <button type="button" className={css.iconButton} aria-label={modeLabel} title={modeLabel} onClick={onToggleFullscreen}>
          {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </button>
        <button type="button" className={css.iconButton} aria-label="关闭" title="关闭" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className={css.scroll}>
        <div className={css.meta} data-tone={failed ? 'fail' : undefined}>
          {block.ts !== undefined && <span>{formatClock(block.ts)}</span>}
          {model.foot !== undefined && <span>{model.foot}</span>}
          <span>{STATE_WORDS[model.state]}</span>
        </div>
        {drawsCard(shell) && (
          <div className={css.card}>
            <CardBody shell={shell} slots={slots} cwd={cwd} home={home} failed={failed} maxLines={Infinity} />
          </div>
        )}
        <div className={css.section}>
          <div className={css.label}>参数</div>
          <pre className={css.pre}>{block.args.length > 0 ? block.args : '(无参数)'}</pre>
        </div>
        {block.tail !== undefined && block.result === undefined && (
          <div className={css.section}>
            <div className={css.label}>实时输出</div>
            <pre className={css.pre}>{block.tail}</pre>
          </div>
        )}
        <div className={css.section}>
          <div className={css.label}>结果</div>
          {block.result === undefined ? (
            <div className={css.label}>（尚未返回）</div>
          ) : (
            <pre className={css.pre} data-error={failed || undefined}>
              {block.output !== undefined && block.output.length > 0 ? block.output : '(无输出)'}
            </pre>
          )}
        </div>
      </div>
    </aside>
  );
}

/** The bodies the panel draws as their own card (the IN/OUT pair is the raw sections). */
function drawsCard(shell: BodyShell): boolean {
  return shell.card !== 'none' && shell.card !== 'io';
}