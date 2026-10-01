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
import { Fragment, useLayoutEffect } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { mentionSegments } from '../mention-tokens.js';
import { composerSurfaceHeight } from './composer-measure.js';
import { cx } from './cx.js';
import css from './InputBar.module.css';

export interface DraftSurfaceProps {
  value: string;
  disabled: boolean;
  /** The placeholder line (also the surface's accessible name). */
  placeholder: string;
  /**
   * The claim's ghost hint (what this command would do next), or null. The bar
   * derives it (`claim-hint.ts`); this surface only draws it.
   */
  hint: string | null;
  /** A composition is open: the placeholder stays hidden under the candidate window. */
  composing: boolean;
  /** The textarea, shared with the bar (it hands focus back after a send). */
  boxRef: RefObject<HTMLTextAreaElement>;
  /** The scrollport around it (the bar chains its wheel gesture outward). */
  scrollRef: RefObject<HTMLDivElement>;
  onChange: (value: string) => void;
  /**
   * The caret moved (typing, an arrow key, a click). Trigger detection is
   * caret-relative — a mention stops being live the moment the caret leaves it
   * — so the bar has to see the selection, not only the text.
   */
  onCaret: (caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
}

export function DraftSurface({
  value,
  disabled,
  placeholder,
  hint,
  composing,
  boxRef,
  scrollRef,
  onChange,
  onCaret,
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
        {/* The mirror: the same draft drawn BEHIND the textarea, in the same
            font and padding, with mentions dressed as chips. A textarea cannot
            hold atomic elements (the harness's editor is a contenteditable), so
            the text is painted twice — once as chrome by this layer, once as
            the real, editable text with a transparent fill on top. It is
            `aria-hidden` and pointer-transparent: it is a picture of the draft,
            never a second input. */}
        <div aria-hidden="true" className={cx(css.mirror, disabled && css.mirrorDisabled)} data-composer-mirror="">
          {mentionSegments(value).map((segment, index) => segment.kind === 'text'
            ? <Fragment key={index}>{segment.text}</Fragment>
            : <span key={index} className={css.mention} title={segment.raw}>{segment.raw}</span>)}
        </div>
        <textarea
          ref={boxRef}
          className={cx(css.input, disabled && css.inputDisabled)}
          value={value}
          rows={1}
          disabled={disabled}
          aria-label={placeholder}
          data-composer-composing={composing ? '' : undefined}
          onChange={(event) => {
            onChange(event.target.value);
            onCaret(event.target.selectionStart);
          }}
          // `onSelect` covers every caret move the browser makes — arrows, a
          // click, Home/End — without the bar having to enumerate the keys.
          onSelect={(event) => { onCaret(event.currentTarget.selectionStart); }}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
        {value === '' && (
          <div aria-hidden="true" className={css.placeholder} data-composer-placeholder="">
            {placeholder}
          </div>
        )}
        {/* The claim's ghost hint. The harness draws it as generated content
            after the last paragraph of its contenteditable — which a textarea
            cannot carry — so here it is an overlay instead: an invisible spacer
            holds the draft's own text in the surface's own font, and the hint
            follows it, landing exactly where the caret sits. A composition
            hides it, for the same reason the placeholder hides. */}
        {hint !== null && !composing && (
          <div aria-hidden="true" className={css.hint} data-composer-hint="">
            <span className={css.hintSpacer}>{value}</span>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}