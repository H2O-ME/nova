/**
 * The operator's model catalog on disk: reading it back, and writing it.
 *
 * Read and write live together because they are one concern (the `models[]`
 * section) and they share one rule the qqbot readers do not: this is the only
 * config block a SURFACE WHOLESALE REPLACES, so what is read back must be
 * exactly what can be written out — any field read here but dropped by the
 * writer would be silently deleted from the operator's file on the next save.
 *
 * Both sides work on the RAW document (`config-doc.ts`), never the loaded
 * `Config`: the load path runs `expandDeep`, so a value that had been expanded
 * would be persisted expanded.
 */
import type { ConfiguredModel } from '@nova-agent/core';
import { docFile, readDoc, patchConfig } from './config-doc.js';

/** One `models[]` entry as a surface writes it; `undefined` means "leave automatic". */
export interface ModelEntryInput {
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

/** A finite positive integer, or undefined for anything else. */
function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** A boolean, or undefined for anything else. */
function boolValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** A non-empty string list, or undefined for anything else. */
function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
  return out.length === 0 ? undefined : out;
}

/**
 * The operator's model list (config `models[]`) as stored.
 *
 * Every field is copied explicitly rather than passed through. This answers a
 * wire frame, and a document the operator hand-edited (or another tool wrote)
 * must not be able to inject something the settings page cannot render — a
 * nested object, a null, a number where a list belongs. An entry without a
 * usable `id` names nothing to select and is dropped.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the stored entries; empty when none are stored, including when there
 *   is no readable config file (the page shows "nothing configured", not a
 *   failure — an absent file and an absent list mean the same thing).
 */
export async function readModels(homedir?: string): Promise<readonly ConfiguredModel[]> {
  let doc: unknown;
  try {
    doc = await readDoc(docFile(homedir));
  } catch {
    return [];
  }
  const listed = (doc as Record<string, unknown>)['models'];
  if (!Array.isArray(listed)) return [];
  const out: ConfiguredModel[] = [];
  for (const item of listed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const id = entry['id'];
    if (typeof id !== 'string' || id.trim() === '') continue;
    const name = entry['name'];
    const contextWindow = positiveInt(entry['contextWindow']);
    const maxOutput = positiveInt(entry['maxOutput']);
    const inputModalities = stringList(entry['inputModalities']);
    const outputModalities = stringList(entry['outputModalities']);
    const attachment = boolValue(entry['attachment']);
    const reasoning = boolValue(entry['reasoning']);
    const toolCall = boolValue(entry['toolCall']);
    out.push({
      id: id.trim(),
      ...(typeof name === 'string' && name.trim() !== '' ? { name: name.trim() } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutput !== undefined ? { maxOutput } : {}),
      ...(inputModalities !== undefined ? { inputModalities } : {}),
      ...(outputModalities !== undefined ? { outputModalities } : {}),
      ...(attachment !== undefined ? { attachment } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(toolCall !== undefined ? { toolCall } : {}),
    });
  }
  return out;
}

/** The capability keys, in the order the written entry lists them (readable file). */
const MODEL_CAPABILITY_KEYS = [
  'contextWindow',
  'maxOutput',
  'inputModalities',
  'outputModalities',
  'attachment',
  'reasoning',
  'toolCall',
] as const;

/** One entry → the plain object to store, dropping every unset field. */
function modelEntryDoc(entry: ModelEntryInput): Record<string, unknown> {
  const out: Record<string, unknown> = { id: entry.id };
  if (entry.name !== undefined) out['name'] = entry.name;
  for (const key of MODEL_CAPABILITY_KEYS) {
    const value = entry[key];
    if (value === undefined) continue;
    // A blank list is not an override — it is a field the editor left empty, and
    // storing `[]` would override models.dev with "knows nothing".
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

/**
 * Write the operator's model list (config `models[]`), replacing it wholesale.
 *
 * Wholesale is the right shape here because the list IS the menu — the settings
 * page owns every row, so an upsert-per-row would need the page to have read the
 * file first and would silently drop a row another surface added meanwhile.
 *
 * Two normalization rules keep the file honest:
 *  - an entry with no `id` is dropped (it names nothing to select);
 *  - an EMPTY list deletes the key entirely, because `[]` and absent mean the
 *    same thing to the reader ("ask the endpoint") and one of them is noise.
 * @param entries - the full list, in the order the panel shows it.
 * @param homedir - Override for tests; defaults to the real home.
 */
export async function saveModels(entries: readonly ModelEntryInput[], homedir?: string): Promise<void> {
  await patchConfig((doc) => {
    const written = entries
      .filter((entry) => typeof entry.id === 'string' && entry.id.trim() !== '')
      .map((entry) => modelEntryDoc({ ...entry, id: entry.id.trim() }));
    if (written.length === 0) {
      delete doc['models'];
      return;
    }
    doc['models'] = written;
  }, homedir);
}

/**
 * Read the session-TITLE model (config `titleModel`), or `null` when unset.
 *
 * Raw-document read for the same reason the rest of this file is: the answer
 * goes back over the wire, and the loaded `Config`'s expanded strings must not
 * become the page's picture of the file.
 * @param homedir - Override for tests; defaults to the real home.
 */
export async function readTitleModel(homedir?: string): Promise<string | null> {
  let doc: unknown;
  try {
    doc = await readDoc(docFile(homedir));
  } catch {
    return null;
  }
  const value = (doc as Record<string, unknown>)['titleModel'];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Write the session-TITLE model. `null` deletes the key — absent and empty mean
 * the same thing to the loader (no titles), and one of them is noise.
 * @param model - the model id, or `null` to clear.
 * @param homedir - Override for tests; defaults to the real home.
 */
export async function saveTitleModel(model: string | null, homedir?: string): Promise<void> {
  await patchConfig((doc) => {
    if (model === null) {
      delete doc['titleModel'];
      return;
    }
    doc['titleModel'] = model;
  }, homedir);
}
