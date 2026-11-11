import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { bootThemeScript } from '../src/shell/boot-theme.js';
import './globals.css';

/**
 * The App Router root layout — the direct successor of the old `index.html`.
 *
 * This file lives in the PROJECT-ROOT `app/` directory, not in `src/app/`.
 * `src/app/` is Nova's own feature folder (App.tsx, AppShell.tsx, routes/) and
 * has nothing to do with Next's file-system routing; the two would collide if
 * Next were pointed at `src/`. Keeping Next's `app/` at the root also makes it
 * impossible to mistake Nova's `src/app/routes/` for Next routes.
 *
 * Everything the Vite entry declared by hand now has a typed home:
 *
 *  - `metadata` replaces the `<head>` block (title, icons, PWA manifest).
 *  - `viewport` replaces `<meta name="viewport">` plus the two `theme-color`
 *    tags; `themeColor` takes a media-query list, exactly the light/dark pair
 *    the hand-written HTML carried.
 *  - the boot script becomes an inline `<script>` in `<head>`.
 *
 * WHY THE BOOT SCRIPT IS INLINE AND WHY IT SITS INSIDE `<body>`
 * -------------------------------------------------------------
 * It resolves theme + font size from `localStorage` and sets `data-nova-dark`
 * before first paint, so the app never flashes the wrong theme. It must be
 * inline (a module import would run after the first paint), and it must be the
 * FIRST CHILD OF `<body>` — it touches `document.body`, which does not exist
 * while `<head>` is parsing. See the note beside the tag itself.
 *
 * `suppressHydrationWarning` on `<html>`: the boot script mutates
 * `documentElement.style.colorScheme` during parse, so server-rendered and
 * client attributes legitimately disagree on that one property. Without the
 * suppression React logs a hydration mismatch on every single load.
 */
export const metadata: Metadata = {
  title: 'Nova',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', type: 'image/png' },
    ],
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#151517' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

/**
 * Theme bootstrap.
 *
 * NOT a hand-written copy. `bootThemeScript()` in `src/shell/boot-theme.ts` is
 * the single source of truth for this script, and `theme.test.ts` exists
 * specifically to catch the two drifting apart — the first version of this
 * migration pasted the body in by hand and that test went red on cue. Its
 * contract: the built script and the mount document must agree on the durable
 * keys (`nova.theme`, `nova.fontSize`), the DOM attribute and the font-size
 * range, and they must agree VERBATIM modulo whitespace/quotes.
 *
 * The default arguments are what the script falls back to before storage is
 * consulted; the script then re-reads `localStorage` itself in the browser, so
 * the static export genuinely ships one script rather than a per-user one.
 */
const BOOT_THEME = bootThemeScript();

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/*
         * THE BOOT SCRIPT MUST BE THE FIRST THING INSIDE `<body>`, and that
         * position is the whole point — not an aesthetic choice.
         *
         * It calls `document.body.toggleAttribute(...)`. In the old Vite
         * `index.html` this script sat at the END of `<body>`, so `body` existed
         * by the time it ran. Moved into `<head>` (the obvious-looking place for
         * a "boot" script) it runs BEFORE `<body>` is parsed and throws
         * `TypeError: Cannot read properties of null (reading 'toggleAttribute')`
         * — measured, and the throw silently killed the dark-mode branch of
         * every load.
         *
         * First child of `<body>` keeps `body` available AND still runs before
         * any content paints, so the flash-of-wrong-theme protection survives.
         * Deferring it to a React effect would also avoid the crash but would
         * paint one light frame first, which is the exact regression the script
         * exists to prevent.
         */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_THEME }} />
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
