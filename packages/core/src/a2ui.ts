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

/**
 * The `Text` component's closed variant enum. `body` is also the default when
 * the model omits the prop, so only a PRESENT, unrecognized value is rejected —
 * an absent one is legal. (There is no h1/h2/h3 in this catalog; a title is
 * `Text` plus `weight`.)
 */
const TEXT_VARIANTS = new Set<unknown>(['body', 'caption']);

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
  return explainA2uiMessages(value).messages;
}

/**
 * The same parse, plus WHY it failed.
 *
 * The model gets a tool result, and "not a legal message list" is not
 * actionable: measured live, a model that wrote `Text.variant: "h2"` (the
 * markdown habit) retried FIVE times with the identical wrong payload, because
 * nothing in the reply said which component or which prop was refused. One
 * sentence naming the component and the offending value is the difference
 * between a self-correcting loop and a dead end.
 * @param value - the tool argument (`messages`), untrusted.
 * @returns the parsed messages, or `messages: undefined` with the first reason.
 */
export function explainA2uiMessages(
  value: unknown,
): { readonly messages: readonly A2uiMessage[] | undefined; readonly reason?: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { messages: undefined, reason: 'messages 必须是非空数组' };
  }
  if (value.length > MAX_A2UI_MESSAGES) {
    return { messages: undefined, reason: `消息条数 ${String(value.length)} 超过上限 ${String(MAX_A2UI_MESSAGES)}` };
  }
  const serialized = safeJson(value);
  if (serialized === undefined) return { messages: undefined, reason: '消息不是可序列化的 JSON' };
  if (serialized.length > MAX_A2UI_BYTES) {
    return { messages: undefined, reason: `序列化后 ${String(serialized.length)} 字节超过上限 ${String(MAX_A2UI_BYTES)}` };
  }
  const out: A2uiMessage[] = [];
  for (const [index, item] of value.entries()) {
    const parsed = explainMessage(item);
    if (parsed.message === undefined) {
      return { messages: undefined, reason: `messages[${String(index)}]: ${parsed.reason ?? '形状不合格'}` };
    }
    out.push(parsed.message);
  }
  // A surface must exist before anything can be written into it. The official
  // processor treats the opposite as an integrity error and refuses the WHOLE
  // batch (`Surface not found for message: main`), so a model that sends only
  // `updateComponents` — measured live, repeatedly, because it is a natural
  // shortcut — produces a card that draws nothing. Catching the ordering here
  // lets the tool result name the missing message instead.
  const created = new Set<string>();
  for (const message of out) {
    if ('createSurface' in message) created.add(message.createSurface.surfaceId);
  }
  for (const [index, message] of out.entries()) {
    const target = 'updateComponents' in message ? message.updateComponents.surfaceId
      : 'updateDataModel' in message ? message.updateDataModel.surfaceId
      : undefined;
    if (target !== undefined && !created.has(target)) {
      return {
        messages: undefined,
        reason: `messages[${String(index)}] 要写入 surface "${target}"，但这批消息里没有它的 createSurface（必须先 createSurface 再 updateComponents / updateDataModel）`,
      };
    }
  }
  return { messages: out };
}

function explainMessage(value: unknown): { readonly message?: A2uiMessage; readonly reason?: string } {
  if (!isRecord(value)) return { reason: '不是对象' };
  const version = value['version'];
  if (version !== undefined && (typeof version !== 'string' || !VERSION_RE.test(version))) {
    return { reason: `version ${JSON.stringify(version)} 不合格（应为 "1.0"）` };
  }
  const keys = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']
    .filter((key) => Object.hasOwn(value, key));
  if (keys.length !== 1) {
    return { reason: '每条消息必须恰好带 createSurface / updateComponents / updateDataModel / deleteSurface 之一' };
  }
  const v = typeof version === 'string' ? version : 'v0.9';
  const key = keys[0]!;
  const body = value[key];
  if (!isRecord(body)) return { reason: `${key} 不是对象` };
  const surfaceId = body['surfaceId'];
  if (!isId(surfaceId)) return { reason: `${key}.surfaceId 不是合法的 id` };
  switch (key) {
    case 'createSurface': {
      const catalogId = body['catalogId'];
      if (catalogId !== undefined && (typeof catalogId !== 'string' || catalogId.length > 512 || hasControlChars(catalogId))) {
        return { reason: 'createSurface.catalogId 不是合法字符串' };
      }
      const sendDataModel = body['sendDataModel'];
      if (sendDataModel !== undefined && typeof sendDataModel !== 'boolean') {
        return { reason: 'createSurface.sendDataModel 必须是布尔值' };
      }
      const components = body['components'] === undefined ? undefined : parseComponents(body['components']);
      if (body['components'] !== undefined && components === undefined) {
        return { reason: `createSurface.components ${describeComponents(body['components'])}` };
      }
      const dataModel = body['dataModel'];
      if (dataModel !== undefined && !isValue(dataModel, 0)) {
        return { reason: 'createSurface.dataModel 不是合法的 JSON 数据（过深、过长或含控制字符）' };
      }
      return {
        message: {
          version: v,
          createSurface: {
            surfaceId,
            ...(catalogId !== undefined ? { catalogId } : {}),
            ...(sendDataModel !== undefined ? { sendDataModel } : {}),
            ...(components !== undefined ? { components } : {}),
            ...(dataModel !== undefined ? { dataModel } : {}),
          },
        },
      };
    }
    case 'updateComponents': {
      const components = parseComponents(body['components']);
      if (components === undefined) {
        return { reason: `updateComponents.components ${describeComponents(body['components'])}` };
      }
      return { message: { version: v, updateComponents: { surfaceId, components } } };
    }
    case 'updateDataModel': {
      const path = body['path'];
      if (path !== undefined && (typeof path !== 'string' || path.length > 512 || !path.startsWith('/') || hasControlChars(path))) {
        return { reason: 'updateDataModel.path 必须是以 / 开头的 JSON Pointer' };
      }
      if (!Object.hasOwn(body, 'value') || !isValue(body['value'], 0)) {
        return { reason: 'updateDataModel.value 缺失或不是合法的 JSON 数据' };
      }
      return {
        message: {
          version: v,
          updateDataModel: { surfaceId, ...(path !== undefined ? { path } : {}), value: body['value'] },
        },
      };
    }
    case 'deleteSurface':
      return { message: { version: v, deleteSurface: { surfaceId } } };
    default:
      return { reason: `不认识的载荷 ${key}` };
  }
}

/**
 * Say what is wrong with a component table in the model's own vocabulary: which
 * component, which rule. This is the sentence that lets a retry succeed.
 * @param value - the components array, untrusted.
 * @returns a short clause for the tool result.
 */
function describeComponents(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '必须是非空数组';
  if (value.length > MAX_A2UI_COMPONENTS) {
    return `条数 ${String(value.length)} 超过上限 ${String(MAX_A2UI_COMPONENTS)}`;
  }
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) return `[${String(index)}] 不是对象`;
    const id = item['id'];
    const name = item['component'];
    const where = typeof id === 'string' ? `组件 "${id}"` : `[${String(index)}]`;
    if (!isId(id)) return `[${String(index)}].id 不是合法的 id`;
    if (typeof name !== 'string') return `${where} 缺少 component 字段（组件名必须写在 component 里，不要用 type）`;
    if (!(A2UI_COMPONENTS as readonly string[]).includes(name)) {
      return `${where} 的 component "${name}" 不在 BASIC catalog 里（可用：${A2UI_COMPONENTS.join('/')}）`;
    }
    if (ids.has(id)) return `${where} 的 id 重复`;
    ids.add(id);
    if (name === 'Text' && !TEXT_VARIANTS.has(item['variant'] ?? 'body')) {
      return `${where} 的 variant ${JSON.stringify(item['variant'])} 不存在；Text 只有 "body"（默认）和 "caption"，标题请用 body 加 weight`;
    }
    const actionReason = actionProblemOf(item['action']);
    if (actionReason !== undefined) return `${where} ${actionReason}`;
    for (const [key, prop] of Object.entries(item)) {
      if (key === 'id' || key === 'component' || key === 'action' || key.startsWith('@')) continue;
      const bindingReason = bindingProblemOf(prop);
      if (bindingReason !== undefined) return `${where} 的 ${key} ${bindingReason}`;
    }
  }
  return '不合格';
}

/**
 * The `action` prop's closed union, as the reason a retry can act on.
 *
 * `action` is `{event:{name, context?, userMessage?}}` or `{functionCall:{...}}`
 * — both arms `.strict()` in web_core's `common-types.js` ActionSchema. The
 * model's habitual error is an event carrying `context` but no `name`; the
 * renderer then reports `Unrecognized key(s) in object: 'event'` (every union arm
 * fails), which names neither the component nor the missing prop.
 * @param action - the component's `action` prop, untrusted.
 * @returns a clause naming the fault, or undefined when the shape is legal.
 */
function actionProblemOf(action: unknown): string | undefined {
  if (action === undefined) return undefined;
  if (!isRecord(action)) return '的 action 必须是对象';
  const event = action['event'];
  if (isRecord(event)) {
    if (typeof event['name'] !== 'string' || event['name'] === '') {
      return '的 action.event 缺少 name（event 必须有字符串 name，context 才有意义）';
    }
    const context = event['context'];
    if (context !== undefined) {
      if (!isRecord(context)) return '的 action.event.context 必须是对象';
      for (const [key, value] of Object.entries(context)) {
        const problem = bindingProblemOf(value);
        if (problem !== undefined) return `的 action.event.context.${key} ${problem}`;
      }
    }
    return undefined;
  }
  return isRecord(action['functionCall']) ? undefined : '的 action 必须是 {event:{name,...}} 或 {functionCall:{...}}';
}

/**
 * A bare `{"path": "/x"}` is the single most misleading thing a model can write
 * here: the published JSON schema ACCEPTS it (a union of both spellings), and
 * the v1.0 renderer then silently treats it as a literal object, so a TextField
 * bound to it paints "[object Object]".
 *
 * The two spellings are version-scoped, not aliases (`web_core`
 * `resolution/data-context.js`: "In v1.0, data bindings must use `@path`. In
 * v0.9, data bindings use `path`"). This product only speaks v1.0, so the bare
 * key is a refusal with a rewrite in it.
 * @param value - a prop value that looks like a data binding.
 * @returns the reason, or undefined when the value is not a binding at all.
 */
function bindingProblemOf(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const hasAt = typeof value['@path'] === 'string';
  const hasBare = typeof value['path'] === 'string';
  if (hasBare && !hasAt) return '是 v0.9 的 {"path":...} 写法；v1.0 必须写 {"@path":"/x"}';
  return undefined;
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
  // The vocabulary's two closed enums that a MODEL reaches for wrongly, checked
  // here rather than in the renderer: `Text.variant: "h2"` is the markdown habit
  // and the single most common rejection. Catching it at the tool boundary is
  // what lets the error come back as a correctable tool result; left to the
  // renderer it became a card that silently drew nothing.
  if (name === 'Text' && !TEXT_VARIANTS.has(value['variant'] ?? 'body')) return undefined;
  if (actionProblemOf(value['action']) !== undefined) return undefined;
  for (const [key, prop] of Object.entries(value)) {
    if (key === 'id' || key === 'component' || key === 'action' || key.startsWith('@')) continue;
    if (bindingProblemOf(prop) !== undefined) return undefined;
  }
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
