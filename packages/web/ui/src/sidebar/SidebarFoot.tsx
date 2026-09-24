/**
 * The sidebar's foot: the settings seat and the connection readout.
 * Ported from deepseek-harness `ui-settings-general/src/client/SettingsRoot.tsx`
 * (the bottom-pinned trigger row that carries the `ConnectionIndicator`) +
 * `SettingsRoot.module.css` (c) 2026 DeepSeek — MIT License.
 *
 * The reference's trigger opens a settings panel; this product has no settings
 * page, so the trigger opens the two axes this surface really owns — the
 * appearance preference (light / dark / follow the system, `theme.ts`) and the
 * content font-size axis the whole transcript is drawn on — as radio rows in
 * the shared menu card. Every row writes the same durable preference the rest
 * of the shell reads, so a choice here is the choice everywhere.
 *
 * The recovery window is the reference's too: a socket that heals reads as
 * 连接成功 for 2s, and only while the column is wide (the reference passes
 * undefined to the rail).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SettingsIcon } from '../icons.js';
import { useAnchoredPopover } from '../shell/anchored-popover.js';
import { useEscapeToClose } from '../shell/use-escape.js';
import { MenuCard, MenuGroup, MenuOption } from '../shell/MenuCard.js';
import { ConnectionIndicator } from './ConnectionIndicator.js';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  THEME_PREFERENCES,
  type ThemePreference,
} from '../theme.js';
import { RECOVERY_CONFIRMATION_MS, SIDEBAR_COPY as COPY, cls, indicatorState } from './view.js';
import type { SocketState } from './view.js';
import css from './SidebarFoot.module.css';

/** The preference rows, labeled by the words the column already carries. */
const APPEARANCE_KEYS: Readonly<Record<ThemePreference, string>> = {
  light: COPY['appearance.light'],
  dark: COPY['appearance.dark'],
  system: COPY['appearance.system'],
};

/** Every integer the font axis accepts (`theme.ts` bounds), as menu rows. */
const FONT_SIZES: readonly number[] = Array.from(
  { length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1 },
  (_unused, index) => FONT_SIZE_MIN + index,
);

export interface SidebarFootProps {
  /** Rail state: 36x36 boxes, no labels, no connection readout. */
  rail: boolean;
  /** The appearance preference in force. */
  preference: ThemePreference;
  /** The content font size in force, in px. */
  fontSize: number;
  connection: SocketState;
  onPickPreference: (preference: ThemePreference) => void;
  onPickFontSize: (size: number) => void;
}

/**
 * Render the column's foot row.
 * @param props - see SidebarFootProps.
 * @returns the trigger row.
 */
export function SidebarFoot({
  rail,
  preference,
  fontSize,
  connection,
  onPickPreference,
  onPickFontSize,
}: SidebarFootProps): JSX.Element {
  // Recovery confirmation: a reconnect that lands shows 连接成功 once, for
  // RECOVERY_CONFIRMATION_MS — the reference's own window and guard.
  const [recovered, setRecovered] = useState(false);
  const previousConnection = useRef(connection);
  useEffect(() => {
    const previous = previousConnection.current;
    previousConnection.current = connection;
    if (connection !== 'open') {
      setRecovered(false);
      return;
    }
    if (previous !== 'closed' && previous !== 'connecting') return;
    setRecovered(true);
    const timer = window.setTimeout(() => { setRecovered(false); }, RECOVERY_CONFIRMATION_MS);
    return () => { window.clearTimeout(timer); };
  }, [connection]);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const close = (): void => { setOpen(false); };
  useEscapeToClose([close]);
  const { cardRef, style } = useAnchoredPopover(triggerRef, {
    open,
    onDismiss: close,
    // Above the trigger: the foot is pinned to the column's bottom edge.
    placement: 'above',
    align: 'start',
  });

  const label = COPY['settings.label'];
  return (
    <div className={cls(css.triggerRow, rail && css.railRow)}>
      <button
        ref={triggerRef}
        type="button"
        className={cls(css.trigger, rail && css.rail)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => { setOpen(!open); }}
      >
        <SettingsIcon className={css.triggerIcon} />
        {!rail && <span className={cls(css.triggerLabel, css.wide)}>{label}</span>}
      </button>
      <ConnectionIndicator
        state={rail ? undefined : indicatorState(connection, recovered)}
        disconnectedLabel={COPY['connection.error']}
        reconnectLabel={COPY['connection.retry']}
        connectingLabel={COPY['connection.connecting']}
        recoveredLabel={COPY['connection.connected']}
        reconnectActionLabel={COPY['connection.reconnect']}
        restartActionLabel={COPY['connection.restart']}
      />
      {open && createPortal(
        <MenuCard cardRef={cardRef} style={style} label={label} data={{ 'data-sidebar-settings': '' }}>
          <MenuGroup title={COPY['appearance.label']}>
            {THEME_PREFERENCES.map((candidate) => (
              <MenuOption
                key={candidate}
                label={APPEARANCE_KEYS[candidate]}
                selected={candidate === preference}
                onClick={() => { onPickPreference(candidate); }}
              />
            ))}
          </MenuGroup>
          <MenuGroup title={COPY['fontSize.label']}>
            {FONT_SIZES.map((candidate) => (
              <MenuOption
                key={candidate}
                label={`${candidate}px`}
                selected={candidate === fontSize}
                onClick={() => { onPickFontSize(candidate); }}
              />
            ))}
          </MenuGroup>
        </MenuCard>,
        document.body,
      )}
    </div>
  );
}