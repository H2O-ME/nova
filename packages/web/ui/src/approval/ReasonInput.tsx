/**
 * The denial-reason field (deepseek-harness `ui-user-questions` AnswerField):
 * an auto-growing textarea over a hidden mirror that owns the height.
 *
 * The mirror renders the draft plus a trailing newline in normal flow and so
 * sizes the grid row (counting rows by '\n' cannot see soft wraps); the
 * textarea shares that one cell and stretches to it, and `rows={1}` keeps the
 * control's own intrinsic height out of the row sizing so the mirror alone
 * decides. Past the mirror's cap the textarea scrolls itself — it is the only
 * scrollport in the stack, there being no second glyph layer to keep aligned.
 * Mirror and textarea MUST share font, line-height, padding and wrapping rules
 * or the two heights diverge (both live in the stylesheet's `.reason > *`).
 *
 * Deliberately dumb: the card owns the draft, the key routing and the focus.
 * Nothing here auto-focuses, because the card's answer keys (y / a / n) are
 * only keys while the caret is NOT in a text field — a caret parked in the
 * reason field would turn `n` into a letter.
 */
import type { ChangeEvent } from 'react';
import css from './ReasonInput.module.css';

/** The field's whole surface: the draft, the edit sink, and the IME window. */
export interface ReasonInputProps {
  value: string;
  /** A submission in flight (or an offline socket) freezes the field. */
  disabled: boolean;
  /** Called with every edit of the draft. */
  onChange: (value: string) => void;
  /** Composition lifecycle: the card widens its IME guard around them. */
  onCompositionStart?: () => void;
  /** Composition lifecycle (see `onCompositionStart`). */
  onCompositionEnd?: () => void;
}

/**
 * @param props - the draft and the card's sinks.
 * @returns The mirrored auto-growing reason field.
 */
export function ReasonInput({
  value,
  disabled,
  onChange,
  onCompositionStart,
  onCompositionEnd,
}: ReasonInputProps): JSX.Element {
  const onEdit = (event: ChangeEvent<HTMLTextAreaElement>): void => onChange(event.target.value);
  return (
    <div className={css.reason}>
      <div aria-hidden className={css.fieldMirror}>{`${value}\n`}</div>
      <textarea
        className={css.fieldInput}
        value={value}
        disabled={disabled}
        rows={1}
        placeholder="拒绝可附理由（回车发送）…"
        aria-label="拒绝理由"
        onChange={onEdit}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
    </div>
  );
}