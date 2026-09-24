/**
 * The composer's text surface: the draft scrollport's content, the harness's
 * `ComposerContentEditable` counterpart (`ui-conversation/src/client/input/
 * editor/ComposerContentEditable.tsx`, MIT) — one surface that grows with the
 * draft, its placeholder riding it absolutely, inside the bar's one scrollport.
 *
 * Ours is a `<textarea>`, so the growth is measured rather than free: the
 * box is set to zero height, its `scrollHeight` is read, and the value is
 * written back (`composerSurfaceHeight` — deliberately unclamped, because the
 * 14-line cap belongs to `.scroll` around it, and a clamped box would clip a
 * long draft instead of scrolling it). The composition window is reported up
 * because the key contract needs it (`composer-keys.ts`) and the stylesheet
 * uses it to hide the placeholder under a candidate window.
 */
import { useLayoutEffect } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { composerSurfaceHeight } from './composer-measure.js';
import { cx } from './cx.js';
import css from './InputBar.module.css';

export interface DraftSurfaceProps {
  value: string;
  disabled: boolean;
  /** The placeholder line (also the surface's accessible name). */
  placeholder: string;
  /** A composition is open: the placeholder stays hidden under the candidate window. */
  composing: boolean;
  /** The textarea, shared with the bar (it hands focus back after a send). */
  boxRef: RefObject<HTMLTextAreaElement>;
  /** The scrollport around it (the bar chains its wheel gesture outward). */
  scrollRef: RefObject<HTMLDivElement>;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
}

export function DraftSurface({
  value,
  disabled,
  placeholder,
  composing,
  boxRef,
  scrollRef,
  onChange,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
}: DraftSurfaceProps): JSX.Element {
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    box.style.height = '0px';
    box.style.height = `${composerSurfaceHeight(box.scrollHeight)}px`;
  }, [boxRef, value]);
  return (
    /* One scrollport, one text surface: the draft grows with its content and
       `.scroll` — capped at 14 lines in CSS — is the only thing that scrolls. */
    <div ref={scrollRef} className={css.scroll} data-input-scroll="">
      <div className={css.grow}>
        <textarea
          ref={boxRef}
          className={cx(css.input, disabled && css.inputDisabled)}
          value={value}
          rows={1}
          disabled={disabled}
          aria-label={placeholder}
          data-composer-composing={composing ? '' : undefined}
          onChange={(event) => { onChange(event.target.value) }}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
        {value === '' && (
          <div aria-hidden="true" className={css.placeholder} data-composer-placeholder="">
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}