/**
 * The IN/OUT card: the harness `ToolRow` body for a call with no structured card
 * (a generic/third-party tool, a call still in flight, or a failure whose card
 * material never arrived).
 *
 * IN is the call's formatted arguments and is dropped when there are none; OUT
 * is the flattened result and is dropped when the call has not reported. The two
 * sections scroll independently (150px each), so a long input never buries a
 * short output.
 */
import css from './GenericCard.module.css';

export interface GenericCardProps {
  /** Formatted arguments, or null when the call had none. */
  input: string | null;
  /** Flattened result text, or null while the call runs. */
  output: string | null;
  /** Draw the OUT text in the error color (a failed call). */
  failed: boolean;
}

export function GenericCard({ input, output, failed }: GenericCardProps): JSX.Element {
  return (
    <div className={css.ioCard}>
      {input !== null && (
        <div className={css.ioSection}>
          <span className={css.ioLabel}>输入</span>
          <span className={css.ioText}>{input}</span>
        </div>
      )}
      {input !== null && output !== null && <span className={css.ioDivider} aria-hidden />}
      {output !== null && (
        <div className={css.ioSection}>
          <span className={css.ioLabel}>输出</span>
          <span className={css.ioText} data-error={failed || undefined}>
            {output}
          </span>
        </div>
      )}
    </div>
  );
}