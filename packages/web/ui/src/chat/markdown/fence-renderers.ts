/**
 * Per-language fence renderers — the seam a plugin-owned UI capability plugs
 * into. A fence whose info string names a registered language is drawn by that
 * renderer instead of the stock code card; unregistered fences fall through to
 * `<pre><code>` exactly as before, so registering zero renderers reproduces the
 * pre-plugin page byte-for-byte.
 *
 * The registry is keyed on the fence's lowercase info string (the markdown
 * parser normalizes casing away before it reaches here). A renderer receives
 * the raw fence body and the streaming flag — the same facts the code card
 * receives — and returns a React node to splice in between the surrounding
 * paragraph breaks. It MUST NOT mutate the body.
 *
 * Why a registry, not a `lang === 'dsh-ui'` branch in `blocks.tsx`: a fence
 * renderer is a plugin-owned capability, and the markdown module is a leaf
 * utility several layers below plugin code. Pulling plugin components into a
 * leaf would invert the package's dependency direction; pushing the branch
 * down into the leaf would force every plugin that wants a fence to edit the
 * markdown parser. A registry keeps the leaf plugin-unaware and lets a plugin
 * register itself from its own module.
 */
import type { ReactNode } from 'react';

/**
 * A fence renderer. The body is the raw fence source (no trailing newline); the
 * streaming flag is true while the body is still growing. Returning `null`
 * lets a renderer give up — the markdown layer then falls back to the code
 * card, the same as an unregistered language.
 */
export type FenceRenderer = (body: string, streaming: boolean) => ReactNode | null;

const registry = new Map<string, FenceRenderer>();

/**
 * Register a renderer for a fence language (lowercase info string). Re-registering
 * a language replaces the previous renderer; the latest registration wins.
 */
export function registerFenceRenderer(lang: string, renderer: FenceRenderer): void {
  if (lang.length === 0) return;
  registry.set(lang.toLowerCase(), renderer);
}

/** Forget a renderer (used by tests and by plugins that tear themselves down). */
export function unregisterFenceRenderer(lang: string): void {
  registry.delete(lang.toLowerCase());
}

/**
 * Resolve a renderer for a fence info string. Returns `undefined` when nothing
 * is registered — the caller then renders the stock code card. Lookup is
 * lowercase-sensitive because the markdown parser already lowercases the info
 * string; keeping the lookup lowercase here makes the contract explicit.
 */
export function fenceRendererFor(lang: string | undefined): FenceRenderer | undefined {
  if (lang === undefined) return undefined;
  return registry.get(lang.toLowerCase());
}
