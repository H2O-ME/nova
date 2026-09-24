/**
 * The model end as a control surface (M11 批10): the shapes a picker needs —
 * *what can be selected* and *what is selected now* — kept apart from the
 * wire client that actually streams (`ChatProvider`), because listing models
 * is a different authority than speaking to one.
 *
 * Three pieces, in dependency order:
 *
 *  - `ModelOption` / `ModelGroup` — the catalog rows, grouped the way a menu
 *    renders them (the harness's provider-grouped list, one group here since
 *    this product configures one endpoint).
 *  - `ModelCatalogPort` — what the OWNING SURFACE supplies: the ids come from
 *    the endpoint itself (`ChatProvider.listModels`), so the surface's job is
 *    only the metadata the endpoint does not report — a display name and the
 *    context window (its models.dev store). Optional by design: a kernel built
 *    without it has no picker, and every surface that does not care (exec,
 *    qqbot) passes nothing.
 *  - `ModelControl` — the kernel-side handle a surface drives: current, list,
 *    select. Switching is a property of the SESSION (`AgentSession.setModel`
 *    publishes the `model` event), so a switch made in the browser is visible
 *    to every other consumer of the same kernel.
 *
 * Nothing here is model-facing: no field reaches a request, so a catalog
 * lookup cannot move the prefix-cache bytes.
 */
import type { ChatProvider } from '../types.js';

/** One selectable model: the id the endpoint knows plus display metadata. */
export interface ModelOption {
  /** Model id as the endpoint knows it (what a request carries). */
  id: string;
  /** Display name — the catalog's, else the id. */
  name: string;
  /** Context window when the surface's metadata knows it (the gauge's denominator). */
  contextWindow?: number;
}

/** One menu group: a heading and its rows. */
export interface ModelGroup {
  id: string;
  name: string;
  models: readonly ModelOption[];
}

/**
 * What the owning surface contributes to the picker. The model IDS are not
 * here: they come from the endpoint itself, so a gateway that adds a model
 * does not need this product re-released. This port answers the questions the
 * endpoint cannot — how to label the group, and what each id means.
 */
export interface ModelCatalogPort {
  /** Heading for the endpoint's models (e.g. the gateway host or provider name). */
  readonly label: string;
  /**
   * Display name + context window for one id, when the surface knows it.
   * Never throws in practice (metadata is best-effort) — an unknown id simply
   * renders as itself with no percentage on the gauge.
   */
  describe(model: string): Promise<{ name?: string; contextWindow?: number } | undefined>;
}

/**
 * The kernel-side model handle. `select` THROWS with a renderable reason when
 * the switch cannot happen (a provider that cannot retarget, an id the
 * endpoint refuses) — surfaces show the reason instead of a silent no-op.
 */
export interface ModelControl {
  /** The model in force right now. */
  current(): string;
  /** The selectable catalog (live: it may change as the endpoint does). */
  list(): Promise<readonly ModelGroup[]>;
  /** Retarget the session's model and announce it on the kernel event stream. */
  select(model: string): Promise<ModelOption>;
}

/** The provider side of a switch, as a capability test (see `ChatProvider`). */
export function canSwitchModels(provider: ChatProvider): provider is ChatProvider & {
  setModel(model: string): void;
} {
  return typeof (provider as { setModel?: unknown }).setModel === 'function';
}