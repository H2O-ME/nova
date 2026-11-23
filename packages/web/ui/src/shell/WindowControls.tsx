/**
 * The frameless window's caption buttons.
 *
 * The desktop shell opens the WebUI in a Tauri window with
 * `decorations: false` (`apps/tauri-bench/src-tauri/tauri.conf.json`), so the
 * three buttons Windows would have drawn are ours: minimise, maximise/restore,
 * close. They are NOT a window-level overlay — the reference renders them
 * inline in the header of the panel that owns the window's top-right corner
 * (conversation header while the side pane is closed, the side pane's own
 * header while it is open, the settings page's header on that page), and this
 * component is that same inline cluster. Whatever surface draws the corner
 * renders it; nothing reserves space for it.
 *
 * There is no Tauri in a browser (and none in the plain `nova --web` surface),
 * so the component renders nothing unless `__TAURI_INTERNALS__` is present —
 * the same bundle serves every surface, and the window plugins' commands are
 * the only privileged call it makes.
 */
import { useCallback, useEffect, useState } from 'react';
import css from './WindowControls.module.css';

/** The slice of Tauri's injected bridge this component uses. */
interface TauriInternals {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  metadata?: { currentWindow?: { label?: string } };
}

function bridge(): TauriInternals | null {
  const host = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return host.__TAURI_INTERNALS__ ?? null;
}

export function WindowControls(): JSX.Element | null {
  // The bridge is installed by the webview's own init script. The runtime page
  // is a REMOTE origin for the shell, and its init can land after React's first
  // paint, so the first read must not decide forever: poll briefly and adopt the
  // bridge when it shows up (in a browser it never does).
  const [api, setApi] = useState<TauriInternals | null>(() => bridge());
  const [maximized, setMaximized] = useState(false);
  const label = api?.metadata?.currentWindow?.label ?? 'main';

  useEffect(() => {
    if (api !== null) return undefined;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const found = bridge();
      if (found !== null) {
        setApi(found);
        window.clearInterval(timer);
      } else if (tries >= 24) {
        window.clearInterval(timer);
      }
    }, 250);
    return () => { window.clearInterval(timer); };
  }, [api]);

  // The window may already be maximised (a remembered geometry): read it once
  // so the middle button shows the right glyph before the first click.
  useEffect(() => {
    if (api === null) return;
    void api
      .invoke('plugin:window|is_maximized', { label })
      .then((value) => { if (typeof value === 'boolean') setMaximized(value); })
      .catch(() => { /* a refused read leaves the restore glyph; harmless */ });
  }, [api, label]);

  const onClick = useCallback(
    (command: string): void => {
      if (api === null) return;
      void api.invoke(command, { label }).catch(() => {});
    },
    [api, label],
  );

  if (api === null) return null;

  return (
    <div className={css.root}>
      <button
        type="button"
        className={css.button}
        aria-label="最小化"
        onClick={() => { onClick('plugin:window|minimize'); }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3.5 8.5H12.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        className={css.button}
        aria-label={maximized ? '还原' : '最大化'}
        onClick={() => {
          onClick('plugin:window|toggle_maximize');
          setMaximized((current) => !current);
        }}
      >
        {maximized ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="3.5" y="5.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1" />
            <path d="M5.5 5.5V4a1 1 0 0 1 1-1H12a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-1.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="3.5" y="3.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={`${css.button} ${css.close}`}
        aria-label="关闭"
        onClick={() => { onClick('plugin:window|close'); }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
