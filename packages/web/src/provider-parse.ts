/**
 * Wire validation for the frames that carry the provider list (BYOK).
 *
 * Split from `model-config-parse.ts` for the same reason that file is split from
 * the dispatcher: this family has its own failure surface. Two things are
 * genuinely different here and neither exists in the model-catalog family:
 *
 *  1. **A credential crosses this seam.** `apiKey` is bounded, control-char-free,
 *     and never echoed; an empty string is normalized to ABSENT so an untouched
 *     field cannot erase a stored key.
 *  2. **A URL reaches `fetch`.** `baseURL` is checked here for length and control
 *     characters, and the host re-derives it with `new URL` before any request —
 *     a shape check on the wire is not the same judgement as "this host will
 *     address it", so both layers answer their own half.
 */
import { hasControlChars } from '@nova-agent/core';
import {
  MAX_API_KEY_CHARS,
  MAX_BASE_URL_CHARS,
  MAX_CONFIGURED_MODELS,
  MAX_MODALITY_CHARS,
  MAX_MODEL_CHARS,
  MAX_MODEL_MODALITIES,
  MAX_PROVIDERS,
  MAX_PROVIDER_NAME_CHARS,
  type ClientFrame,
} from './protocol.js';
import { reject, type FrameRejection } from './reject.js';
import type { WireProviderInput, WireProviderModel } from './provider-wire.js';

/**
 * Provider ids: the page generates them, the kernel binds to them, and they end
 * up as JSON keys and file contents. Lowercase words with digits and `-`/`_` is
 * the same discipline `SWITCH_NAME_RE` applies to plugin names — deliberately no
 * `.` here, because a dotted id reads like a version or a path fragment.
 */
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A finite positive integer, or undefined (absent and malformed are the same). */
function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * A bounded, control-char-free string that may be ABSENT, or a rejection reason.
 *
 * Distinguishes "not sent" (undefined) from "sent wrong" (a rejection) the same
 * way the model parser does: the host must be able to tell an untouched field
 * from an overridden one.
 */
function optionalText(value: unknown, field: string, max: number): string | undefined | FrameRejection {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return reject(`${field} must be a string`);
  if (value.length > max) return reject(`${field} exceeds ${max} chars`);
  if (hasControlChars(value)) return reject(`${field} contains control characters`);
  return value.trim();
}

/** A bounded string list (modalities), or a rejection reason. */
function optionalModalities(value: unknown, field: string): readonly string[] | FrameRejection | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return reject(`${field} must be an array of strings`);
  if (value.length > MAX_MODEL_MODALITIES) return reject(`${field} exceeds ${MAX_MODEL_MODALITIES} entries`);
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) return reject(`${field} must hold non-empty strings`);
    if (entry.length > MAX_MODALITY_CHARS) return reject(`${field} entry exceeds ${MAX_MODALITY_CHARS} chars`);
    if (hasControlChars(entry)) return reject(`${field} entry contains control characters`);
    out.push(entry.trim());
  }
  return out;
}

/** One `providers[].models[]` entry, or a rejection reason. */
function parseProviderModel(item: unknown, at: string): { entry: WireProviderModel } | FrameRejection {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return reject(`${at} must be an object`);
  const obj = item as Record<string, unknown>;
  const id = optionalText(obj['id'], `${at}.id`, MAX_MODEL_CHARS);
  if (id === undefined || typeof id !== 'string' || id.length === 0) {
    return typeof id === 'string' ? reject(`${at}.id must be a non-empty string`) : id ?? reject(`${at}.id is required`);
  }
  const name = optionalText(obj['name'], `${at}.name`, MAX_MODEL_CHARS);
  if (name !== undefined && typeof name !== 'string') return name;
  const inputModalities = optionalModalities(obj['inputModalities'], `${at}.inputModalities`);
  // A rejection is `{ok: false}`; a warning-free list is an array. Discriminate on
  // that rather than on `typeof`, so the two cases cannot be confused.
  if (inputModalities !== undefined && 'ok' in inputModalities) return inputModalities;
  const outputModalities = optionalModalities(obj['outputModalities'], `${at}.outputModalities`);
  if (outputModalities !== undefined && 'ok' in outputModalities) return outputModalities;
  const contextWindow = optionalCount(obj['contextWindow']);
  const maxOutput = optionalCount(obj['maxOutput']);
  const attachment = typeof obj['attachment'] === 'boolean' ? obj['attachment'] : undefined;
  const reasoning = typeof obj['reasoning'] === 'boolean' ? obj['reasoning'] : undefined;
  const toolCall = typeof obj['toolCall'] === 'boolean' ? obj['toolCall'] : undefined;
  return {
    entry: {
      id,
      ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutput !== undefined ? { maxOutput } : {}),
      ...(inputModalities !== undefined ? { inputModalities } : {}),
      ...(outputModalities !== undefined ? { outputModalities } : {}),
      ...(attachment !== undefined ? { attachment } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(toolCall !== undefined ? { toolCall } : {}),
    },
  };
}

/** One `providers[]` entry, or a rejection reason. */
function parseProvider(item: unknown, index: number): { entry: WireProviderInput } | FrameRejection {
  const at = `save_providers.providers[${String(index)}]`;
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return reject(`${at} must be an object`);
  const obj = item as Record<string, unknown>;
  const id = obj['id'];
  if (typeof id !== 'string' || !PROVIDER_ID_RE.test(id)) {
    return reject(`${at}.id must be a lowercase identifier (letters, digits, "-", "_")`);
  }
  const baseURL = optionalText(obj['baseURL'], `${at}.baseURL`, MAX_BASE_URL_CHARS);
  if (typeof baseURL !== 'string' || baseURL.length === 0) {
    return typeof baseURL === 'string' ? reject(`${at}.baseURL must be a non-empty string`) : baseURL ?? reject(`${at}.baseURL is required`);
  }
  const name = optionalText(obj['name'], `${at}.name`, MAX_PROVIDER_NAME_CHARS);
  if (name !== undefined && typeof name !== 'string') return name;
  // An EMPTY key means "the field was left untouched", not "erase it": the
  // browser cannot read the stored value back, so sending `''` must be
  // indistinguishable from omitting the field. Normalizing here keeps that rule
  // in one place instead of asking every writer to remember it.
  const rawKey = obj['apiKey'];
  let apiKey: string | undefined;
  if (rawKey !== undefined) {
    if (typeof rawKey !== 'string') return reject(`${at}.apiKey must be a string`);
    if (rawKey.length > MAX_API_KEY_CHARS) return reject(`${at}.apiKey exceeds ${MAX_API_KEY_CHARS} chars`);
    if (hasControlChars(rawKey)) return reject(`${at}.apiKey contains control characters`);
    apiKey = rawKey.length === 0 ? undefined : rawKey;
  }
  const models: WireProviderModel[] = [];
  const rawModels = obj['models'];
  if (rawModels !== undefined) {
    if (!Array.isArray(rawModels)) return reject(`${at}.models must be an array`);
    if (rawModels.length > MAX_CONFIGURED_MODELS) return reject(`${at}.models exceeds ${MAX_CONFIGURED_MODELS} entries`);
    for (const [modelIndex, model] of rawModels.entries()) {
      const parsed = parseProviderModel(model, `${at}.models[${String(modelIndex)}]`);
      if ('ok' in parsed) return parsed;
      models.push(parsed.entry);
    }
  }
  const temperature = typeof obj['temperature'] === 'number' ? obj['temperature'] : undefined;
  const maxTokens = optionalCount(obj['maxTokens']);
  const contextWindow = optionalCount(obj['contextWindow']);
  return {
    entry: {
      id,
      baseURL,
      ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(models.length > 0 ? { models } : {}),
    },
  };
}

/**
 * Validate one provider-family frame.
 * @param type - the frame's `type` (already narrowed by the caller's switch).
 * @param obj - the raw frame object.
 * @returns the parsed frame, or a rejection reason.
 */
export function parseProviderFrame(
  type: 'list_providers' | 'save_providers' | 'set_provider' | 'probe_provider',
  obj: Record<string, unknown>,
): ClientFrame | FrameRejection {
  if (type === 'list_providers') return { type: 'list_providers' };
  if (type === 'set_provider') {
    const id = obj['id'];
    if (typeof id !== 'string' || !PROVIDER_ID_RE.test(id)) {
      return reject('set_provider.id must be a lowercase identifier');
    }
    return { type: 'set_provider', id };
  }
  if (type === 'probe_provider') {
    const baseURL = optionalText(obj['baseURL'], 'probe_provider.baseURL', MAX_BASE_URL_CHARS);
    if (typeof baseURL !== 'string' || baseURL.length === 0) {
      return typeof baseURL === 'string'
        ? reject('probe_provider.baseURL must be a non-empty string')
        : baseURL ?? reject('probe_provider.baseURL is required');
    }
    const rawKey = obj['apiKey'];
    let apiKey: string | undefined;
    if (rawKey !== undefined) {
      if (typeof rawKey !== 'string') return reject('probe_provider.apiKey must be a string');
      if (rawKey.length > MAX_API_KEY_CHARS) return reject(`probe_provider.apiKey exceeds ${MAX_API_KEY_CHARS} chars`);
      if (hasControlChars(rawKey)) return reject('probe_provider.apiKey contains control characters');
      apiKey = rawKey.length === 0 ? undefined : rawKey;
    }
    return { type: 'probe_provider', baseURL, ...(apiKey !== undefined ? { apiKey } : {}) };
  }
  const raw = obj['providers'];
  if (!Array.isArray(raw)) return reject('save_providers.providers must be an array');
  if (raw.length > MAX_PROVIDERS) return reject(`save_providers.providers exceeds ${MAX_PROVIDERS} entries`);
  const providers: WireProviderInput[] = [];
  for (const [index, item] of raw.entries()) {
    const parsed = parseProvider(item, index);
    if ('ok' in parsed) return parsed;
    providers.push(parsed.entry);
  }
  // Duplicate ids would make `activeProvider` ambiguous and let one row's save
  // silently overwrite another's — rejected rather than collapsed, because the
  // page's own list is what disagreed.
  const seen = new Set<string>();
  for (const provider of providers) {
    if (seen.has(provider.id)) return reject(`save_providers.providers repeats id "${provider.id}"`);
    seen.add(provider.id);
  }
  const rawActive = obj['activeId'];
  let activeId: string | undefined;
  if (rawActive !== undefined) {
    if (typeof rawActive !== 'string' || !PROVIDER_ID_RE.test(rawActive)) {
      return reject('save_providers.activeId must be a lowercase identifier');
    }
    if (!seen.has(rawActive)) return reject(`save_providers.activeId "${rawActive}" is not in the list`);
    activeId = rawActive;
  }
  return { type: 'save_providers', providers, ...(activeId !== undefined ? { activeId } : {}) };
}
