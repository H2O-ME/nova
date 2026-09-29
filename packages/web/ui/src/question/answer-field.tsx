/**
 * Auto-growing free-text answer: a textarea, so a long answer soft-wraps and
 * Shift+Enter breaks a line, over a hidden mirror that owns the height.
 * Mirror and textarea MUST share font, line-height, padding and wrapping rules
 * or the two heights diverge. Adapted from the reference's `AnswerField`
 * (`ui-user-questions`).
 */
import css from './QuestionPanel.module.css';

export interface AnswerFieldProps {
  /** The custom row's inline copy column, or the optionless question's frame. */
  variant: 'inline' | 'block';
  value: string;
  disabled: boolean;
  placeholder: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function AnswerField({
  variant,
  value,
  disabled,
  placeholder,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  onKeyDown,
}: AnswerFieldProps): JSX.Element {
  return (
    <div className={`${css.field} ${variant === 'inline' ? css.customInline : css.customBlock}`}>
      {/* The mirror is the first child so the textarea (the later, interactive
         layer) stacks on top of it in the same grid cell. */}
      <div aria-hidden className={css.fieldMirror}>{`${value}\n`}</div>
      <textarea
        className={css.fieldInput}
        value={value}
        disabled={disabled}
        rows={1}
        placeholder={placeholder}
        onChange={onChange}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
