/**
 * The session header's fixed controls: 新会话 and 设置.
 *
 * They used to live in the session sidebar's foot; the sidebar is gone, and the
 * header is where the shell's chrome consolidated (the harness keeps its settings seat
 * in the sidebar's foot — that is the one recorded deviation, since this
 * surface no longer has that column). The icon seat is the kit's 28px standard;
 * only the text verb keeps its own sheet.
 */
import type { ReactNode } from 'react';
import { IconButton } from '../kit/IconButton.js';
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

/** The header's icon seat (the settings gear), on the kit's standard button. */
export function HeaderIconButton(props: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  const isSettings = props.label === SHELL_COPY['settings.label'];
  return (
    <IconButton
      label={props.label}
      active={props.active}
      onClick={props.onClick}
      {...(isSettings ? { 'aria-haspopup': 'dialog' as const, 'aria-expanded': props.active } : {})}
    >
      {props.children}
    </IconButton>
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
