/**
 * The BYOK rows as they cross the wire.
 *
 * Kept apart from the STORED shape (`cli/src/config-providers.ts`) on purpose,
 * and the difference is the whole point of the split:
 *
 *  - the file carries `apiKey` (a secret, or an `{env:NAME}` reference);
 *  - the wire carries `hasApiKey` (a boolean) and, on the way IN, an `apiKey`
 *    that is optional and means "replace the stored one".
 *
 * One type shared by both directions would have to make `apiKey` optional, and a
 * page could then render `provider.apiKey` and read `undefined` for a provider
 * that does have a key — or, worse, a reader could mistake the field for the
 * stored value and echo a credential that never came from the server. Two names
 * keep "what I may see" and "what I may say" from being the same thing.
 */

/** One provider row the settings page DRAWS. Never carries the key. */
export interface WireProviderRow {
  /** Stable binding id. Renaming a provider must not move the active pointer. */
  id: string;
  /** Display name the operator typed; absent means "show the host". */
  name?: string;
  baseURL: string;
  /**
   * Whether a key is stored. A boolean, not the key: the browser learns enough
   * to draw 已配置/未配置 without ever holding a credential.
   */
  hasApiKey: boolean;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  /** This provider's own model list (config `providers[].models`). */
  models: readonly WireProviderModel[];
}

/** One model row inside a provider. Mirrors `ConfiguredModel` without importing it. */
export interface WireProviderModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutput?: number;
  inputModalities?: readonly string[];
  outputModalities?: readonly string[];
  attachment?: boolean;
  reasoning?: boolean;
  toolCall?: boolean;
}

/** One provider row the settings page SENDS on save. */
export interface WireProviderInput {
  id: string;
  name?: string;
  baseURL: string;
  /**
   * The key the operator just typed. ABSENT means "keep the stored one" — the
   * browser cannot read the stored value, so an untouched field must not become
   * an erasure. An empty string is normalized to absent by the validator.
   */
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  models?: readonly WireProviderModel[];
}
