/**
 * The 插件 center as a PAGE, not a settings section.
 *
 * The reference (`ui-plugin-manager`) contributes the sidebar's Plugins panel
 * and its page owns the MAIN COLUMN; Nova shipped the same page as a section
 * inside the settings dialog, which put the kernel's roster two clicks deep
 * behind 设置 while 新会话 / sessions stayed one click away. The placement is
 * the whole point of this file — the page itself is the SAME `PluginsSection`
 * the settings dialog used to carry, so there is one roster, one set of
 * switches and one place they are written from.
 */
import type { ClientFrame } from '../types.js';
import type { PluginsSnapshot, RosterSnapshot } from '../state.js';
import { PluginsSection } from './PluginsSection.js';
import css from './PluginCenterPage.module.css';

export interface PluginCenterPageProps {
  /** The last roster snapshot; null until the first answer lands. */
  roster: RosterSnapshot | null;
  /** The manager's last flip answer; null until the first flip lands. */
  plugins: PluginsSnapshot | null;
  /** An ask is pending or the socket is down: the switches refuse. */
  disabled: boolean;
  /** The last management refusal, or null (see `PluginsSection`). */
  manageError: { readonly seq: number; readonly message: string } | null;
  send: (frame: ClientFrame) => void;
}

export function PluginCenterPage({
  roster,
  plugins,
  disabled,
  manageError,
  send,
}: PluginCenterPageProps): JSX.Element {
  return (
    <div className={css.page} data-plugin-center="">
      <div className={css.column}>
        {/* No `onClose`: that seat belongs to the modal's Escape chain, and this
            page is not a modal — the reader leaves it by picking a session. */}
        <PluginsSection
          roster={roster}
          plugins={plugins}
          disabled={disabled}
          manageError={manageError}
          send={send}
        />
      </div>
    </div>
  );
}
