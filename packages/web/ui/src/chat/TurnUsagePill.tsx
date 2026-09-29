/**
 * The turn-usage pill — port of the harness `ui-chat`'s `TurnUsagePanel.tsx`
 * (c) 2026 DeepSeek — MIT License: a database pill on the assistant tail that
 * reads `用量 24.2K tok` and opens the settled run's accounting panel (model,
 * cache hit, uncached input, cache read, output). The dialog skin is the
 * stats pills' (the same sheet this port already carries); the numbers come
 * from the kernel's `run_stats` for that turn — the surface measures nothing.
 *
 * The panel is PORTALED, as the reference portals it: the tail lives in the
 * transcript, whose root clips vertically (`overflow-y: clip`), so an in-place
 * card opening above the pill would be cropped the moment the row sat near the
 * scrollport's top edge.
 */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover } from '../shell/anchored-popover.js';
import { formatExactTokens, formatTokens, cacheHitText } from '../format.js';
import { DatabaseIcon } from '../composer/Icons.js';
import type { RunStats } from '../types.js';
import css from './TurnUsagePill.module.css';

export interface TurnUsagePillProps {
  /** The settled run's numbers (the turn's `run_stats`). */
  stats: RunStats;
  /** The display name of the model that served the run, when known. */
  modelName: string | null;
}

/**
 * The pill with its own open state — the form the tail row mounts.
 * @param props - see {@link TurnUsagePillProps}.
 * @returns the usage trigger (plus its panel while open), or null without tokens.
 */
export function TurnUsagePill(props: TurnUsagePillProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  return <TurnUsageTrigger {...props} open={open} onToggle={() => { setOpen(!open); }} />;
}

export interface TurnUsageTriggerProps extends TurnUsagePillProps {
  /** The panel is shown. */
  open: boolean;
  onToggle: () => void;
}

/**
 * Render the usage trigger and, while open, its panel. Hidden entirely when
 * the run reported no tokens at all: a pill reading `用量 0 tok` is a claim
 * about nothing.
 */
export function TurnUsageTrigger({ stats, modelName, open, onToggle }: TurnUsageTriggerProps): JSX.Element | null {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const { cardRef, style } = useAnchoredPopover(rootRef, {
    open,
    onDismiss: onToggle,
    placement: 'above',
    align: 'end',
  });

  const total = stats.promptTokens + stats.completionTokens;
  if (total <= 0) return null;
  const cacheHit = cacheHitText(stats.cachedTokens, stats.promptTokens);
  const uncached = Math.max(0, stats.promptTokens - stats.cachedTokens);

  const panel = (
    <div ref={cardRef} className={css.panel} role="dialog" aria-label="本轮用量" style={style}>
      <div className={css.panelTitle}>
        <span className={css.panelTitleLabel}><DatabaseIcon />本轮用量</span>
        <span className={css.panelTitleValue}>{formatExactTokens(total)} tok</span>
      </div>
      <div className={css.panelRule} aria-hidden="true" />
      <dl className={css.details} data-turn-usage-details>
        {modelName !== null && (
          <>
            <dt>模型</dt>
            <dd>{modelName}</dd>
          </>
        )}
        {cacheHit !== undefined && (
          <>
            <dt>缓存命中</dt>
            <dd>{`${cacheHit}%`}</dd>
          </>
        )}
        <dt>未缓存输入</dt>
        <dd>{formatExactTokens(uncached)} tok</dd>
        {stats.cachedTokens > 0 && (
          <>
            <dt>缓存读取</dt>
            <dd>{formatExactTokens(stats.cachedTokens)} tok</dd>
          </>
        )}
        <dt>输出</dt>
        <dd>{formatExactTokens(stats.completionTokens)} tok</dd>
      </dl>
    </div>
  );

  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`本轮用量：${formatTokens(total)} tok`}
        onClick={onToggle}
      >
        <DatabaseIcon />
        <span className={css.label}>{`用量 ${formatTokens(total)} tok`}</span>
      </button>
      {/* The static render lane (the DOM-free unit tests) has no document to
          portal into; the markup is identical either way. */}
      {open && (typeof document === 'undefined' ? panel : createPortal(panel, document.body))}
    </span>
  );
}
