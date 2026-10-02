/**
 * The session header's fixed controls: 新会话 and 设置.
 *
 * They used to live in the session sidebar's foot; the sidebar is gone, and the
 * header is where the shell's chrome consolidated (dsh keeps its settings seat
 * in the sidebar's foot — that is the one recorded deviation, since this
 * surface no longer has that column). Both are the shell's 28px recipe: a 28px
 * box around a 15px glyph, tokens only.
 */
import type { ReactNode } from 'react';
import { PlusIcon, SettingsIcon } from '../icons.js';
import { SHELL_COPY } from '../shell/copy.js';
import css from './HeaderButtons.module.css';

/** The header's 新会话 verb: starts a fresh session log. */
export function NewSessionButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className={css.textButton}
      aria-label={SHELL_COPY['session.new.label']}
      title={SHELL_COPY['session.new.label']}
      onClick={onClick}
    >
      <span className={css.glyph} aria-hidden="true"><PlusIcon /></span>
      <span className={css.textLabel}>{SHELL_COPY['session.new']}</span>
    </button>
  );
}

/** A 28px icon button in the shell's own recipe (the header's settings seat). */
export function HeaderIconButton(props: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className={css.iconButton}
      aria-label={props.label}
      aria-haspopup={props.label === SHELL_COPY['settings.label'] ? 'dialog' : undefined}
      aria-expanded={props.label === SHELL_COPY['settings.label'] ? props.active : undefined}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** The header's settings seat (the gear). */
export function SettingsButton(props: { active: boolean; onClick: () => void }): JSX.Element {
  return (
    <HeaderIconButton label={SHELL_COPY['settings.label']} active={props.active} onClick={props.onClick}>
      <SettingsIcon className={css.glyph} />
    </HeaderIconButton>
  );
}
