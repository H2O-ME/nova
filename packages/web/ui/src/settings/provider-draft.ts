/**
 * The editable shape of one provider row (`providers[]`).
 *
 * Numbers stay TEXT while a card is open: rewriting a keystroke straight into a
 * number turns `256K` into `256000` under the reader's cursor, and the parse
 * back to a number only happens on save (`toInputRow`). The draft therefore
 * mirrors the wire row but for those three fields.
 *
 * It lives in its own module because both the roster (`ProviderSection`) and
 * one card's editor (`ProviderCardEditor`) need the type, and the editor must
 * not import the roster to get it.
 */
import type { WireProviderModel } from '../types.js';

/** 编辑中的一行：数字字段保持文本态（逐击键写回数字会把 `256K` 改写成 `256000`）。 */
export interface ProviderDraft {
  /** Stable binding id; only a new row mints one, a stored row keeps its own. */
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  temperature: string;
  maxTokens: string;
  contextWindow: string;
  /**
   * FULL model entries, not bare ids: `providers[].models` rows carry per-model
   * overrides (name / window / modality caps), and collapsing them to ids on the
   * way into the draft silently ERASED every override the moment a card was
   * saved. A hand-typed addition is an id-only entry; a stored one round-trips
   * field for field.
   */
  models: readonly WireProviderModel[];
}
