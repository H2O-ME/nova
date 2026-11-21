/**
 * A2UI v1.0 wire vocabulary and its one fail-closed parser.
 *
 * A2UI is the agent-composed-UI protocol (https://a2ui.org): the model emits a
 * small stream of JSON messages — create a surface, place a flat component
 * table, update its data model — and the client renders it with native widgets.
 * Buttons carry an `action` whose context paths are resolved against the data
 * model before the action is sent back to the agent.
 *
 * This file owns SHAPE and VALIDATION only. Rendering, styling and the local
 * two-way binding live in `packages/web/ui/src/a2ui`; which components a given
 * catalog offers is a renderer fact, but the BASIC catalog is the protocol's
 * floor, so its names are pinned here (a model must not invent `FancyTable`).
 *
 * Caps are explicit and fail-closed: a tool argument is untrusted model output,
 * and a renderer must never receive a payload its own scrollback cannot carry.
 */
import { hasControlChars } from './text.js';

/** The BASIC catalog's components (https://a2ui.org specification v1.0). */
export const A2UI_COMPONENTS = [
  'AudioPlayer', 'Button', 'Card', 'CheckBox', 'ChoicePicker', 'Column',
  'DateTimeInput', 'Divider', 'Icon', 'Image', 'List', 'Modal', 'Row',
  'Slider', 'Tabs', 'Text', 'TextField', 'Video',
] as const;

export type A2uiComponentName = typeof A2UI_COMPONENTS[number];

/** One component in the flat adjacency list. Extra keys are component props. */
export interface A2uiComponent {
  readonly id: string;
  readonly component: string;
  readonly [prop: string]: unknown;
}

/** One agent → renderer message. Exactly one payload key is present. */
export type A2uiMessage =
  | {
      readonly version: string;
      readonly createSurface: {
        readonly surfaceId: string;
        readonly catalogId?: string;
        readonly sendDataModel?: boolean;
        readonly components?: readonly A2uiComponent[];
        readonly dataModel?: unknown;
      };
    }
  | {
      readonly version: string;
      readonly updateComponents: { readonly surfaceId: string; readonly components: readonly A2uiComponent[] };
    }
  | {
      readonly version: string;
      readonly updateDataModel: { readonly surfaceId: string; readonly path?: string; readonly value: unknown };
    }
  | { readonly version: string; readonly deleteSurface: { readonly surfaceId: string } };

/** Messages one tool call may carry. */
export const MAX_A2UI_MESSAGES = 24;
/** Components one message may carry (the flat table's ceiling). */
export const MAX_A2UI_COMPONENTS = 200;
/** Serialized budget for the whole message list, below the 40 KiB result cap. */
export const MAX_A2UI_BYTES = 32 * 1024;
/** One component/surface id. */
export const MAX_A2UI_ID_CHARS = 128;
/** One string value inside a component or the data model. */
export const MAX_A2UI_TEXT_CHARS = 8_000;
/** Nesting depth of one data value (a guard, not a product limit). */
export const MAX_A2UI_VALUE_DEPTH = 12;

const VERSION_RE = /^[A-Za-z0-9._-]{1,16}$/u;
const ID_RE = /^[\p{L}\p{N}_.:-]{1,128}$/u;

/**
 * Parse and validate a list of A2UI messages.
 *
 * Fail-closed: any malformed message rejects the WHOLE list, because a partial
 * surface is worse than no surface — the model can retry one well-formed call.
 * @param value - the tool argument (`messages`), untrusted.
 * @returns the validated messages, or undefined when the payload is not A2UI.
 */
export function parseA2uiMessages(value: unknown): readonly A2uiMessage[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_A2UI_MESSAGES) return undefined;
  // One size gate up front: later per-field checks are structure, not payload.
  const serialized = safeJson(value);
  if (serialized === undefined || serialized.length > MAX_A2UI_BYTES) return undefined;
  const out: A2uiMessage[] = [];
  for (const item of value) {
    const message = parseMessage(item);
    if (message === undefined) return undefined;
    out.push(message);
  }
  return out;
}

function parseMessage(value: unknown): A2uiMessage | undefined {
  if (!isRecord(value)) return undefined;
  const version = value['version'];
  if (version !== undefined && (typeof version !== 'string' || !VERSION_RE.test(version))) return undefined;
  const keys = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']
    .filter((key) => Object.hasOwn(value, key));
  if (keys.length !== 1) return undefined;
  const v = typeof version === 'string' ? version : 'v0.9';
  const key = keys[0]!;
  const body = value[key];
  if (!isRecord(body)) return undefined;
  const surfaceId = body['surfaceId'];
  if (!isId(surfaceId)) return undefined;
  switch (key) {
    case 'createSurface': {
      const catalogId = body['catalogId'];
      if (catalogId !== undefined && (typeof catalogId !== 'string' || catalogId.length > 512 || hasControlChars(catalogId))) {
        return undefined;
      }
      const sendDataModel = body['sendDataModel'];
      if (sendDataModel !== undefined && typeof sendDataModel !== 'boolean') return undefined;
      const components = body['components'] === undefined ? undefined : parseComponents(body['components']);
      if (body['components'] !== undefined && components === undefined) return undefined;
      const dataModel = body['dataModel'];
      if (dataModel !== undefined && !isValue(dataModel, 0)) return undefined;
      return {
        version: v,
        createSurface: {
          surfaceId,
          ...(catalogId !== undefined ? { catalogId } : {}),
          ...(sendDataModel !== undefined ? { sendDataModel } : {}),
          ...(components !== undefined ? { components } : {}),
          ...(dataModel !== undefined ? { dataModel } : {}),
        },
      };
    }
    case 'updateComponents': {
      const components = parseComponents(body['components']);
      if (components === undefined) return undefined;
      return { version: v, updateComponents: { surfaceId, components } };
    }
    case 'updateDataModel': {
      const path = body['path'];
      if (path !== undefined && (typeof path !== 'string' || path.length > 512 || !path.startsWith('/') || hasControlChars(path))) {
        return undefined;
      }
      if (!Object.hasOwn(body, 'value') || !isValue(body['value'], 0)) return undefined;
      return {
        version: v,
        updateDataModel: { surfaceId, ...(path !== undefined ? { path } : {}), value: body['value'] },
      };
    }
    case 'deleteSurface':
      return { version: v, deleteSurface: { surfaceId } };
    default:
      return undefined;
  }
}

function parseComponents(value: unknown): readonly A2uiComponent[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_A2UI_COMPONENTS) return undefined;
  const out: A2uiComponent[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const component = parseComponent(item);
    if (component === undefined || ids.has(component.id)) return undefined;
    ids.add(component.id);
    out.push(component);
  }
  return out;
}

function parseComponent(value: unknown): A2uiComponent | undefined {
  if (!isRecord(value)) return undefined;
  const id = value['id'];
  const name = value['component'];
  if (!isId(id) || typeof name !== 'string' || !(A2UI_COMPONENTS as readonly string[]).includes(name)) return undefined;
  const out: Record<string, unknown> = { id, component: name };
  for (const [key, prop] of Object.entries(value)) {
    if (key === 'id' || key === 'component' || key.startsWith('@')) continue;
    if (hasControlChars(key) || key.length > 64) return undefined;
    if (!isValue(prop, 0)) return undefined;
    out[key] = prop;
  }
  return out as A2uiComponent;
}

/** JSON-safe, size- and depth-bounded value: strings, numbers, booleans, null, arrays, records. */
function isValue(value: unknown, depth: number): boolean {
  if (depth > MAX_A2UI_VALUE_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= MAX_A2UI_TEXT_CHARS && !hasControlChars(value, { multiline: true });
  if (Array.isArray(value)) {
    if (value.length > 1000) return false;
    return value.every((item) => isValue(item, depth + 1));
  }
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 200) return false;
  for (const [key, item] of entries) {
    if (key.length > 128 || hasControlChars(key)) return false;
    if (!isValue(item, depth + 1)) return false;
  }
  return true;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    // A cyclic or BigInt-bearing object is not a wire payload.
    return undefined;
  }
}
