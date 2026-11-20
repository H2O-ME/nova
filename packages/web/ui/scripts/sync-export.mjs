/**
 * Copies the Next static export into the directory the desktop shell embeds.
 *
 * WHY THIS STEP EXISTS
 * --------------------
 * `next build` with `output: 'export'` writes to `ui/out/`, but the shell's
 * `frontendDist` (`apps/tauri-bench/src-tauri/tauri.conf.json`) points at
 * `packages/web/public` — one fixed directory the bundle step reads, so the
 * build tool can be replaced without touching the shell.
 *
 * WHAT IS PRESERVED
 * -----------------
 * `public/` in the served tree is ALSO where the PWA icons, the manifest and
 * `favicon.svg` live, and those are not produced by the Next build (they are
 * hand-maintained assets that happen to share the directory). Wiping
 * `packages/web/public` before copying would delete them. So the sync:
 *
 *   1. clears only build-owned paths (`_next/`, `index.html`, the stale files
 *      below),
 *   2. copies the export over the top,
 *   3. leaves every unmanaged file alone.
 *
 * Copying the export over the top rather than clearing first is what makes an
 * interrupted build non-destructive: the worst case is a stale page, never a
 * missing icon.
 *
 * RSC DEBRIS. `output: 'export'` also emits `*.txt` payloads for the App
 * Router's flight protocol (`__next._tree.txt`, `index.txt`, `404.txt`, …).
 * Those exist so a Next SERVER can answer RSC navigations; this app has no Next
 * server — the page is single-route and client-only — so they are unreachable
 * dead weight in the served tree. Removed explicitly rather than left to
 * accumulate.
 */
import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(uiRoot, 'out');
const target = path.resolve(uiRoot, '..', 'public');

if (!existsSync(outDir)) {
  throw new Error(`next export missing: ${outDir} — run \`next build\` first`);
}

// Build-owned output. `_next` is fully regenerated every build, so a stale chunk
// left behind would be servable by URL after it stopped existing in the manifest.
await rm(path.join(target, '_next'), { recursive: true, force: true });
await rm(path.join(target, 'index.html'), { force: true });

// Any flight-payload text file from a previous export.
if (existsSync(target)) {
  for (const entry of await readdir(target)) {
    if (entry.endsWith('.txt')) await rm(path.join(target, entry), { force: true });
  }
}

await mkdir(target, { recursive: true });

// `recursive: true` merges directories rather than replacing them, so the PWA
// icons / manifest / favicon survive.
await cp(outDir, target, { recursive: true, force: true });

// …and drop the ones the copy just brought in.
for (const entry of await readdir(target)) {
  if (entry.endsWith('.txt')) await rm(path.join(target, entry), { force: true });
}

process.stdout.write(`next export → ${target}\n`);

