/**
 * Composer context-occupancy meter, ported from deepseek-harness
 * `ui-conversation` ContextMeter.tsx / ContextMeter.module.css (c) 2026
 * DeepSeek — MIT License: a 14px ring and its percentage reading in the
 * composer's dock row — the same seat the source mounts it in (beside the
 * stats pills, under the card) — with a click-open panel carrying the
 * reading, the used/window figures and the occupancy bar.
 *
 * Data honesty: the source panel splits the reading from provider pressure and
 * a heuristic `contextBreakdown` (system/tools/messages). This surface has no
 * breakdown — only the last request's prompt tokens and the window — so the
 * legend rows are not ported (they would be invented numbers) and the figures
 * carry no `~` prefix (ours is a reported count, not a projection). The panel
 * therefore stops where the source stops when its own breakdown is absent:
 * header plus bar, no `dl`.
 *
 * There is no compact action in this panel, in the source or here: compaction
 * is the `/compact` command, which the kernel's command directory already
 * publishes and the composer's `/` menu already reaches. A second entry point
 * living inside a readout was an invention of this port and is gone.
 *
 * The source's render gate is ported too: nothing renders until a request has
 * reported usage (the source waits for the `contextPressure` projection; ours
 * waits for a non-zero numerator), so a fresh session's dock carries no
 * 「0%」 noise. One deliberate difference remains: the trigger stays mounted
 * once usage exists even if the window is unknown (the panel says so in words
 * instead of inventing a denominator), and the panel's bar paints from
 * `severityForUsage` — the trigger's ring stays the sheet's neutral tertiary,
 * but a 70%/90% band change on the bar happens in theme.ts alone.
 */
import { useEffect, useRef, useState } from 'react';
import { useDismissOutside } from '../shell/anchored-popover.js';
import { formatTokens } from '../format.js';
import { severityForUsage } from '../theme.js';
import css from './ContextMeter.module.css';

/** Ring geometry: 14px viewBox, 2px stroke. */
const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Marker the localized occupancy sentence is split on, so the panel headline
 * keeps the reading in its own tone while each locale still owns the word
 * order (`45% of context used` / `上下文已用 45%`).
 */
const READING_SLOT = '\u0000';
/** The sentence the marker sits in (the source's `context.aria` seat). */
const OCCUPANCY = `上下文已用 ${READING_SLOT}`;

/** Said instead of a reading while the model's window is unknown. */
const UNKNOWN_WINDOW = '上下文窗口未知';

/** The sentence as the user reads it, with the reading filled in. */
function occupancySentence(reading: string): string {
  return OCCUPANCY.replace(READING_SLOT, reading);
}

/**
 * Inline custom properties sit outside CSSProperties' closed typing, so the one
 * property the ported sheet reads its tint from is cast here, once.
 * @param tint - the severity token expression the segment paints with.
 * @returns the style object carrying the meter tint.
 */
function tintStyle(tint: string): React.CSSProperties {
  return { '--meter-tint': tint } as React.CSSProperties;
}

export interface ContextMeterProps {
  /** Prompt tokens of the last request (the meter's numerator). */
  usedTokens: number;
  /** The model's window in tokens; null/0 = unknown (the panel says so). */
  contextWindow: number | null;
  /**
   * @deprecated The panel carries no action; compaction is `/compact`, and the
   * kernel command directory plus the composer's `/` menu are its only doors.
   * Retained so existing call sites compile until their prop is deleted.
   */
  onCompact?: (() => void) | undefined;
  /** @deprecated Companion of {@link ContextMeterProps.onCompact}. */
  compactDisabled?: boolean;
}

export function ContextMeter({
  usedTokens,
  contextWindow,
}: ContextMeterProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  // Outside click / Escape close: the shared dismissal rule plus this panel's
  // own Escape binding (it is not in the shell's layer stack: it lives in the
  // composer, where Escape aborts the run).
  useDismissOutside(open, [rootRef], () => { setOpen(false); });
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, [open]);

  // The source's gate: no reported pressure, no meter — a fresh session's
  // dock stays clean instead of reading a meaningless 0%. It sits after the
  // hooks: a session's first usage would otherwise change the hook count
  // between renders.
  if (usedTokens <= 0) return null;
  const available = contextWindow !== null && contextWindow > 0;

  const percent = available
    ? Math.round(Math.min(1, Math.max(0, usedTokens / contextWindow)) * 100)
    : 0;
  const reading = `${percent}%`;
  const sentence = available ? occupancySentence(reading) : UNKNOWN_WINDOW;
  const [headBefore = '', headAfter = ''] = occupancySentence(READING_SLOT)
    .split(READING_SLOT)
    .map((part) => part.trim());

  // The bar's overall length stays the reported percent. A zero-width segment
  // is dropped instead of rendered: `.segment`'s min-width keeps a hairline
  // part visible, which at 0% occupancy would draw a filled bar over an empty
  // context.
  const segments = percent > 0 ? [{ key: 'total', width: percent }] : [];

  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        title={sentence}
        aria-label={sentence}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
          <circle className={css.track} cx="7" cy="7" r={RADIUS} />
          <circle
            className={css.fill}
            cx="7"
            cy="7"
            r={RADIUS}
            strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
        <span>{reading}</span>
      </button>
      {open && (
        <div className={css.panel} role="dialog" aria-label="上下文已用">
          <div className={css.header}>
            {available ? (
              <>
                {/* Empty sides collapse through `.headline:empty` so the locale that
                    needs no leading (or trailing) text spends no header gap. */}
                <span className={css.headline}>{headBefore}</span>
                <span className={css.percent}>{reading}</span>
                <span className={css.headline}>{headAfter}</span>
                <span className={css.figures}>
                  {`${formatTokens(usedTokens)} / ${formatTokens(contextWindow)}`}
                </span>
              </>
            ) : (
              <>
                <span className={css.headline}>{UNKNOWN_WINDOW}</span>
                <span className={css.figures}>{formatTokens(usedTokens)}</span>
              </>
            )}
          </div>
          {segments.length > 0 && (
            <div className={css.bar}>
              {segments.map((segment) => (
                <div
                  key={segment.key}
                  className={css.segment}
                  style={{ width: `${segment.width}%`, ...tintStyle(severityForUsage(percent / 100)) }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
