/**
 * The server half of the composer's model seat: the catalog fetch, the switch,
 * and the two facts `ready`/`state` have to carry about it — the label in force
 * and the context window behind it.
 *
 * It lives beside the controller rather than inside it because it is the one
 * place a frame needs remembered state: the window must be CLEARED when the new
 * model reports none, or the gauge keeps dividing by the previous model's
 * number. The browser's `ModelSeat.tsx` is the other half — that one renders,
 * this one decides, and neither duplicates the other's job.
 */
import type { ModelControl, ModelGroup } from '@nova-agent/core';

/**
 * Why the menu shows an empty list beside a Retry instead of closing. A
 * surface-owned sentence: the wire carries reasons, never prose the browser
 * would have to assemble from parts.
 */
export const MODEL_LIST_FAILED = '无法读取站点的模型目录（网络或鉴权失败）';

/** The gap reported when this kernel was assembled without a catalog port. */
const NO_CATALOG = '本次启动未提供模型目录';

/** The answer to `list_models` — the wire frame's payload, minus its `type`. */
export interface ModelCatalogAnswer {
  groups: readonly ModelGroup[];
  current: string;
  error?: string;
}

export class ModelSeat {
  private label: string;
  private displayName: string | undefined;
  private window: number | undefined;

  constructor(
    private readonly models: ModelControl | undefined,
    shellLabel: string,
    shellWindow: number | undefined,
    shellName?: string,
  ) {
    this.label = shellLabel;
    this.displayName = shellName;
    this.window = shellWindow;
  }

  /** Whether a switch is possible at all — false keeps the chip inert text. */
  get switching(): boolean {
    return this.models !== undefined;
  }

  /** The model in force: the live client's id when it has one, else the shell's label. */
  get model(): string {
    return this.models?.current() || this.label;
  }

  /**
   * The label a reader sees: the catalog's name for the model in force, or the
   * id when nobody has metadata for it. An endpoint publishes ids, never
   * labels, so the shell and this seat's own catalog are the only sources.
   */
  get name(): string {
    return this.displayName ?? this.model;
  }

  get contextWindow(): number | undefined {
    return this.window;
  }

  /**
   * A kernel `model` event landed. The seat follows the session rather than the
   * picker's optimism, so a switch the endpoint never applied cannot move the
   * label. An unreported window clears the denominator instead of keeping the
   * previous model's — a wrong percentage is worse than no percentage — and an
   * unreported name falls back to the id.
   *
   * Re-stating the clients is the caller's: whoever owns the sockets decides
   * when to broadcast, and this class never talks to them.
   */
  apply(model: string, detail: { name?: string; contextWindow?: number }): void {
    this.label = model;
    this.displayName = detail.name;
    this.window = detail.contextWindow;
  }

  /** Ask the endpoint, on demand — never at boot (a cold start must not wait). */
  async list(): Promise<ModelCatalogAnswer> {
    if (this.models === undefined) return { groups: [], current: this.model, error: NO_CATALOG };
    // A failure is the ANSWER (an empty menu with a Retry), never a dead socket.
    const groups = await this.models.list().catch(() => undefined);
    return groups === undefined
      ? { groups: [], current: this.model, error: MODEL_LIST_FAILED }
      : { groups, current: this.model };
  }

  /** Retarget the wire client; the kernel then announces it, which re-states us. */
  async select(model: string): Promise<void> {
    if (this.models === undefined) throw new Error(NO_CATALOG);
    await this.models.select(model);
  }
}