/**
 * The management refusal banner, shared by the three sections that write config
 * (插件管理 / Skill 中心 / QQ 机器人).
 *
 * It exists because a refusal was invisible. Every managed write answers a
 * rejection with an `error` frame rather than a fresh snapshot, and the reducer
 * parks that in `state.manageError` — but no component ever rendered
 * `manageError.message`. The sections only read it to release their in-flight
 * control, so "本轮运行中不能切换插件开关" and "核心功能不可关闭" both reached
 * nobody: the operator clicked, the control went back to looking normal, and
 * nothing explained why the flip did not happen.
 *
 * `role="alert"` is deliberate: this sentence appears as the direct result of a
 * press, so it must be announced rather than merely present. It is one line of
 * text and no dismiss control — the next write attempt replaces it, and a
 * banner the reader has to close becomes a second thing to get wrong.
 */
import { SETTINGS_COPY } from './copy.js';
import css from './ManageError.module.css';

export interface ManageErrorProps {
  /**
   * The refusal sentence, or null. The caller decides whether the error is
   * OURS: the channel is shared, so a section must compare the sequence it was
   * on when it sent (see each section's own `attributed`).
   */
  message: string | null;
}

/**
 * Render the refusal banner, or nothing when there is no refusal to show.
 * @param props - see ManageErrorProps.
 * @returns the banner element, or null.
 */
export function ManageError({ message }: ManageErrorProps): JSX.Element | null {
  if (message === null) return null;
  return (
    <div className={css.error} role="alert">
      <span className={css.title}>{SETTINGS_COPY['manage.errorTitle']}</span>
      <span className={css.detail}>{message}</span>
    </div>
  );
}
