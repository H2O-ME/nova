/**
 * Wire validation for the frames that carry the operator's model catalog.
 *
 * Split out for the same reason `fs-frame-parse.ts` is: the frame parser is a
 * dispatch table over frame SHAPES, and thirty lines of per-field capability
 * bounds would bury it. This is the one frame family besides the workspace paths
 * whose payload becomes a FILE (the config), so every field is bounded here
 * rather than trusted to the page.
 *
 * The real authority is still the host's `saveModels`, which normalizes what it
 * writes; the two judgements belong at those two layers.
 */
import { hasControlChars, type ConfiguredModel } from '@nova-agent/core';
import { MAX_CONFIGURED_MODELS, MAX_MODALITY_CHARS, MAX_MODEL_CHARS, MAX_MODEL_MODALITIES, MAX_TITLE_MODEL_CHARS, type ClientFrame } from './protocol.js';
import { reject, type FrameRejection } from './reject.js';

/** A finite positive integer, or undefined for anything else (including absent). */
function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** A boolean, or undefined for anything else (including absent). */
function optionalBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** A bounded, control-char-free string list, or a rejection reason. */
function optionalModalities(value: unknown, field: string): readonly string[] | string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return `${field} must be an array of strings`;
  if (value.length > MAX_MODEL_MODALITIES) return `${field} exceeds ${MAX_MODEL_MODALITIES} entries`;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) return `${field} must hold non-empty strings`;
    if (entry.length > MAX_MODALITY_CHARS) return `${field} entry exceeds ${MAX_MODALITY_CHARS} chars`;
    if (hasControlChars(entry)) return `${field} entry contains control characters`;
    out.push(entry.trim());
  }
  return out;
}

/** A bounded, control-char-free string, or a rejection reason. */
function boundedText(value: unknown, field: string): string | FrameRejection {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return reject(`${field} must be a non-empty string`);
  }
  if (value.length > MAX_MODEL_CHARS) return reject(`${field} exceeds ${MAX_MODEL_CHARS} chars`);
  if (hasControlChars(value)) return reject(`${field} contains control characters`);
  return value.trim();
}

/**
 * One `models[]` entry off the wire, or a rejection reason.
 *
 * Every capability field is optional and an ABSENT field is preserved as absent:
 * the host must be able to tell "the operator overrode nothing" from "the
 * operator overrode it with this value", or writing a rename would freeze the
 * automatic models.dev metadata at whatever it happened to be. Unknown keys are
 * ignored rather than rejected because this is a forward-compatible seam (an
 * older host meeting a newer page), unlike the config file's own `.strict()`.
 * @param item - the raw entry.
 * @param index - its position, for the rejection message.
 * @returns the entry, or a rejection reason.
 */
function parseConfiguredModel(item: unknown, index: number): { entry: ConfiguredModel } | FrameRejection {
  const at = `save_models.models[${String(index)}]`;
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return reject(`${at} must be an object`);
  const obj = item as Record<string, unknown>;
  const id = boundedText(obj['id'], `${at}.id`);
  if (typeof id !== 'string') return id;

  const rawName = obj['name'];
  let name: string | undefined;
  if (rawName !== undefined) {
    const parsedName = boundedText(rawName, `${at}.name`);
    if (typeof parsedName !== 'string') return parsedName;
    name = parsedName;
  }
  const inputModalities = optionalModalities(obj['inputModalities'], `${at}.inputModalities`);
  if (typeof inputModalities === 'string') return reject(inputModalities);
  const outputModalities = optionalModalities(obj['outputModalities'], `${at}.outputModalities`);
  if (typeof outputModalities === 'string') return reject(outputModalities);
  const contextWindow = optionalCount(obj['contextWindow']);
  const maxOutput = optionalCount(obj['maxOutput']);
  const attachment = optionalBool(obj['attachment']);
  const reasoning = optionalBool(obj['reasoning']);
  const toolCall = optionalBool(obj['toolCall']);
  return {
    entry: {
      id,
      ...(name !== undefined ? { name } : {}),
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

/**
 * Validate one model-catalog frame.
 * @param type - the frame's `type` (already narrowed by the caller's switch).
 * @param obj - the raw frame object.
 * @returns the parsed frame, or a rejection reason.
 */
export function parseModelConfigFrame(
  type: 'list_model_config' | 'save_models' | 'set_title_model',
  obj: Record<string, unknown>,
): ClientFrame | FrameRejection {
  if (type === 'list_model_config') return { type: 'list_model_config' };
  if (type === 'set_title_model') {
    // `null` clears the setting; a string is a model id under the same bounds as
    // `set_model`'s (same kind of value, same abuse surface).
    const raw = obj['model'];
    if (raw === null) return { type: 'set_title_model', model: null };
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return reject('set_title_model.model must be a non-empty string or null');
    }
    if (raw.length > MAX_TITLE_MODEL_CHARS) {
      return reject(`set_title_model.model exceeds ${MAX_TITLE_MODEL_CHARS} chars`);
    }
    if (hasControlChars(raw)) return reject('set_title_model.model contains control characters');
    return { type: 'set_title_model', model: raw.trim() };
  }
  const raw = obj['models'];
  if (!Array.isArray(raw)) return reject('save_models.models must be an array');
  if (raw.length > MAX_CONFIGURED_MODELS) {
    return reject(`save_models.models exceeds ${MAX_CONFIGURED_MODELS} entries`);
  }
  const models: ConfiguredModel[] = [];
  for (const [index, item] of raw.entries()) {
    const parsed = parseConfiguredModel(item, index);
    if ('ok' in parsed) return parsed;
    models.push(parsed.entry);
  }
  // Duplicate ids would write two rows that render identically and select the
  // same model — a menu the operator cannot reason about. Rejected here rather
  // than silently collapsed, because the page's own list is the thing that
  // disagreed.
  const seen = new Set<string>();
  for (const model of models) {
    const key = model.id.toLowerCase();
    if (seen.has(key)) return reject(`save_models.models repeats id "${model.id}"`);
    seen.add(key);
  }
  return { type: 'save_models', models };
}
