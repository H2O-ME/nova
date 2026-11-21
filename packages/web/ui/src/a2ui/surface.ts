/**
 * The A2UI surface fold: messages in, one component table + one data model per
 * surface out. Pure (no React, no DOM) so the binding rules are testable and the
 * renderer stays a projection.
 *
 * Supported payloads are the BASIC catalog's: a flat component list rooted at
 * `root`, values bound with `{"path": …}` (v0.9) or `{"@path": …}` (v1.0), and
 * button actions shaped `{"event":{"name":…,"context":{…}}}`.
 */
import type { A2uiComponent, A2uiMessage } from '@nova-agent/core';

/** One renderable surface: its components and the current data model. */
export interface A2uiSurface {
  readonly id: string;
  readonly components: ReadonlyMap<string, A2uiComponent>;
  readonly data: unknown;
  /** The agent asked for the whole model on every action (`sendDataModel`). */
  readonly sendDataModel: boolean;
}

/** Fold the agent's messages into the surfaces to draw, in creation order. */
export function buildSurfaces(messages: readonly A2uiMessage[]): readonly A2uiSurface[] {
  const surfaces = new Map<string, { id: string; components: Map<string, A2uiComponent>; data: unknown; sendDataModel: boolean }>();
  for (const message of messages) {
    if ('createSurface' in message) {
      const surface = {
        id: message.createSurface.surfaceId,
        components: new Map<string, A2uiComponent>(),
        data: message.createSurface.dataModel ?? {},
        // v0.9's examples omit the flag; only an explicit `true` opts in.
        sendDataModel: (message.createSurface as { sendDataModel?: unknown }).sendDataModel === true,
      };
      for (const component of message.createSurface.components ?? []) surface.components.set(component.id, component);
      surfaces.set(surface.id, surface);
    } else if ('updateComponents' in message) {
      const surface = surfaces.get(message.updateComponents.surfaceId)
        ?? { id: message.updateComponents.surfaceId, components: new Map<string, A2uiComponent>(), data: {}, sendDataModel: false };
      for (const component of message.updateComponents.components) surface.components.set(component.id, component);
      surfaces.set(surface.id, surface);
    } else if ('updateDataModel' in message) {
      const surface = surfaces.get(message.updateDataModel.surfaceId);
      if (surface === undefined) continue;
      const path = message.updateDataModel.path;
      surface.data = path === undefined || path === '/' || path === ''
        ? message.updateDataModel.value
        : setAtPath(surface.data, path, message.updateDataModel.value);
    } else {
      surfaces.delete(message.deleteSurface.surfaceId);
    }
  }
  return [...surfaces.values()];
}

/**
 * Resolve one bound value against a scope (a template item) and the root data.
 * Absolute paths (`/…`) always read the root; relative ones read the scope.
 */
export function resolveValue(value: unknown, data: unknown, scope: unknown = data): unknown {
  if (!isRecord(value)) return value;
  const path = typeof value['@path'] === 'string' ? value['@path'] : typeof value['path'] === 'string' ? value['path'] : undefined;
  if (path !== undefined) return getAtPath(path.startsWith('/') ? data : scope, path);
  // A catalog function this renderer does not implement degrades to its bound
  // input rather than an empty cell — the common `formatCurrency(value)` case.
  if (typeof value['@call'] === 'string') {
    const args = value['args'];
    return isRecord(args) && Object.hasOwn(args, 'value') ? resolveValue(args['value'], data, scope) : '';
  }
  return value;
}

/** The value as display text (numbers/booleans stringify; objects stay JSON). */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => asText(item)).join(', ');
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** The path a two-way bound control writes back to, or undefined when unbound. */
export function bindPath(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const path = value['@path'] ?? value['path'];
  return typeof path === 'string' && path.startsWith('/') ? path : undefined;
}

/** Read a JSON Pointer (`/a/b`) out of a value. */
export function getAtPath(value: unknown, path: string): unknown {
  if (path === '' || path === '/') return value;
  let current = value;
  for (const raw of path.replace(/^\//u, '').split('/')) {
    if (current === null || current === undefined) return undefined;
    const key = raw.replace(/~1/gu, '/').replace(/~0/gu, '~');
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

/** Immutable upsert: one path in, a copied spine out. */
export function setAtPath(value: unknown, path: string, next: unknown): unknown {
  if (path === '' || path === '/') return next;
  const [head, ...rest] = path.replace(/^\//u, '').split('/');
  if (head === undefined) return next;
  const key = head.replace(/~1/gu, '/').replace(/~0/gu, '~');
  const restPath = rest.length === 0 ? '/' : `/${rest.join('/')}`;
  if (Array.isArray(value)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) return value;
    const copy = [...value];
    copy[index] = rest.length === 0 ? next : setAtPath(copy[index], restPath, next);
    return copy;
  }
  const record = isRecord(value) ? value : {};
  return { ...record, [key]: rest.length === 0 ? next : setAtPath(record[key], restPath, next) };
}

/** One resolved button action, ready to be sent back as a user turn. */
export interface A2uiAction {
  readonly name: string;
  readonly context: Readonly<Record<string, unknown>>;
}

/** Resolve a component's `action.event` against the model, or undefined. */
export function actionOf(component: A2uiComponent, data: unknown): A2uiAction | undefined {
  const action = component['action'];
  if (!isRecord(action)) return undefined;
  const event = action['event'];
  if (!isRecord(event) || typeof event['name'] !== 'string' || event['name'].length === 0) return undefined;
  const context = isRecord(event['context']) ? event['context'] : {};
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) resolved[key] = resolveValue(value, data);
  return { name: event['name'], context: resolved };
}

/** The child ids a container draws, stamping `key` for React lists. */
export function childIds(component: A2uiComponent): readonly string[] {
  const children = component['children'];
  if (Array.isArray(children)) return children.filter((id): id is string => typeof id === 'string');
  const child = component['child'];
  return typeof child === 'string' ? [child] : [];
}

/**
 * A List's template children: `{path, componentId}` over an array in the model.
 * @returns one row of `{key, id, scope}` per item.
 */
export function templateRows(component: A2uiComponent, data: unknown): readonly { key: string; id: string; scope: unknown }[] {
  const children = component['children'];
  if (!isRecord(children) || typeof children['path'] !== 'string' || typeof children['componentId'] !== 'string') return [];
  const items = resolveValue({ path: children['path'] }, data);
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => ({ key: String(index), id: children['componentId'] as string, scope: item }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
