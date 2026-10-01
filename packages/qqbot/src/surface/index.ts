/**
 * The surface half of this package: the `AgentSurface` a host registers under
 * name `qqbot`, the bridge a `nova --web` process runs in-band, the settings
 * page's live-channel seam, and the credential probe.
 *
 * These four were cli files until 2026-10-01 — the product shape (peer turns,
 * credentials policy, the three-step save path) is this demo package's story,
 * not the shell's. A host supplies exactly two reads: where credentials come
 * from (a raw-document reader, because `{env:NAME}` resolvability is a config
 * rule) and how a `[qqbot]` line is painted.
 */
export * from './activate.js';
export * from './bridge.js';
export * from './mode.js';
export * from './probe.js';
