/**
 * The terminal page's emulator lifecycle, extracted from the view.
 *
 * One hook owns everything xterm needs a DOM for: the dynamic import (the
 * SSR test lane renders the view to a string, so construction must live in an
 * effect, not at module scope), the mount into the host element, the input
 * and resize wiring, and teardown. The view renders a host div, consumes the
 * reducer's owed byte batches and draws the status band — the parts that stay
 * testable without a DOM.
 *
 * The api is a REF, not state: keystrokes and resizes are events, and the
 * open effect reads the live grid rather than re-rendering on every one.
 */
import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { ClientFrame } from '../types.js';
import { RIGHTBAR_COPY } from './copy.js';

/** The thin surface the mount effect exposes to the render path. */
export interface EmulatorApi {
  write(data: string): void;
  reset(): void;
  focus(): void;
  /** The emulator's current grid (what `term_open`/`term_resize` carry). */
  grid(): { cols: number; rows: number };
}

/** What the view needs to drive the emulator it cannot see. */
export interface TerminalEmulator {
  /** Attach the emulator here (set as the host element's ref). */
  hostRef: (element: HTMLDivElement | null) => void;
  /** The live emulator, once constructed; null before the import resolves. */
  api: React.MutableRefObject<EmulatorApi | null>;
  /** Whether the emulator exists and the open effect may send `term_open`. */
  ready: boolean;
  /** Why the emulator could not load, when it could not. */
  loadError: string | null;
  /** The editor's send port, for keystrokes and resizes. */
  sendRef: React.MutableRefObject<(frame: ClientFrame) => void>;
}

/**
 * Build the terminal emulator once per mount.
 *
 * Dynamic import keeps the SSR lane free of xterm and lets the browser bundle
 * pay for it only when this tab is opened (the reference's `LazyTerminalBody`
 * carries the same split). Keystrokes go back verbatim; a size change is a
 * fact about the HOST, not keystrokes — the panel can be resized or the dock
 * moved without the reader touching a key.
 * @returns the host ref, the api ref, and the ready/error flags.
 */
export function useTerminalEmulator(): TerminalEmulator {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const apiRef = useRef<EmulatorApi | null>(null);
  const sendRef = useRef<(frame: ClientFrame) => void>(() => {});
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (host === null) return;
    let disposed = false;
    let emulator: Terminal | null = null;
    let observer: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    void (async () => {
      try {
        // xterm's OWN stylesheet rides along: the helper layer's rules live
        // there and nowhere else — `.xterm-char-measure-element { visibility:
        // hidden }` hides the width-cache probe, whose text is the last
        // measured glyph repeated 32×. Without it that probe paints a
        // shifting line of junk characters above the first row (the reported
        // 乱码: a line of `>` before cmd's banner), and the helper textarea
        // renders as a box. Loading it here keeps CSS and constructor
        // together — never a half-styled terminal.
        const [{ Terminal: Xterm }, { FitAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/xterm/css/xterm.css'),
        ]);
        if (disposed) return;
        const instance = new Xterm({
          cursorBlink: true,
          minimumContrastRatio: 4.5,
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          scrollback: 4000,
          theme: { background: 'transparent', foreground: window.getComputedStyle(host).color },
        });
        const fit = new FitAddon();
        instance.loadAddon(fit);
        instance.open(host);
        fit.fit();
        // The emulator's ink follows the page's theme: foreground and cursor
        // are re-read from the host's computed style whenever the document's
        // theme attribute flips (the reference's `TerminalTheme.update`; the
        // background stays transparent — the page's own layer paints it).
        const applyTheme = (): void => {
          instance.options.theme = {
            background: 'transparent',
            foreground: window.getComputedStyle(host).color,
            cursor: window.getComputedStyle(host).color,
          };
        };
        applyTheme();
        themeObserver = new MutationObserver(applyTheme);
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-ds-dark-theme'],
        });
        instance.onData((data) => { sendRef.current({ type: 'term_input', data }); });
        instance.textarea?.setAttribute('aria-label', RIGHTBAR_COPY['term.output']);
        emulator = instance;
        apiRef.current = {
          write: (d) => { instance.write(d); },
          reset: () => { instance.reset(); },
          focus: () => { instance.focus(); },
          grid: () => ({ cols: instance.cols, rows: instance.rows }),
        };
        observer = new ResizeObserver(() => {
          try { fit.fit(); } catch { /* zero-sized host (hidden tab) */ }
          const api = apiRef.current;
          if (api === null) return;
          sendRef.current({ type: 'term_resize', cols: api.grid().cols, rows: api.grid().rows });
        });
        observer.observe(host);
        setReady(true);
      } catch (err) {
        if (disposed) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      themeObserver?.disconnect();
      apiRef.current = null;
      setReady(false);
      try {
        emulator?.dispose();
      } catch {
        // A half-constructed emulator (open threw) has nothing left to tear down.
      }
    };
  }, [host]);

  return { hostRef: setHost, api: apiRef, ready, loadError, sendRef };
}
