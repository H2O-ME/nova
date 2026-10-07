/**
 * Validation for a plugin's own settings page, as it arrives over the wire.
 *
 * A `page` answer is PLUGIN-OWNED data: the browser renders whatever a third
 * party returned, and the renderer indexes into its collections
 * (`fields.map`, `guide.length`, `options.map`) without a guard — a descriptor
 * with `fields: {}` or a field missing its `key` did not merely look wrong, it
 * THREW, and the settings panel died with it. The descriptor's shape lives in
 * core (`PluginPageDescriptor`), but a type annotation proves nothing at this
 * boundary: the value crossed JSON and a plugin boundary, so it is re-checked
 * here, once, before any rendering sees it.
 *
 * The check is FAIL-CLOSED on what the renderer indexes, tolerant on what it
 * only prints: a missing `title` falls back to the plugin's name, an unknown
 * extra key is ignored, and a `status` row's `tone` outside the known set
 * renders as the neutral dot (the same fail-quiet choice `toneDot` makes).
 */

import type { PluginPageDescriptor } from '../types.js';

export type PageDescriptorParse =
  | { ok: true; page: PluginPageDescriptor }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The four field kinds the renderer knows; anything else cannot be drawn. */
const FIELD_KINDS = new Set(['text', 'secret', 'select', 'switch']);

/**
 * Validate one plugin-returned page descriptor.
 * @param value - the `result` an answer carried, exactly as received.
 * @returns the typed descriptor, or the reason it cannot be rendered.
 */
export function parsePageDescriptor(value: unknown): PageDescriptorParse {
  if (!isRecord(value)) return { ok: false, reason: '页面描述不是对象' };
  const page = value as unknown as PluginPageDescriptor & Record<string, unknown>;
  for (const key of ['title', 'intro', 'note'] as const) {
    const field = page[key];
    if (field !== undefined && typeof field !== 'string') {
      return { ok: false, reason: `${key} 必须是字符串` };
    }
  }
  const guide = page['guide'];
  if (guide !== undefined && !isStringArray(guide)) {
    return { ok: false, reason: 'guide 必须是字符串数组' };
  }
  const status = page['status'];
  if (status !== undefined) {
    if (!Array.isArray(status)) return { ok: false, reason: 'status 必须是数组' };
    for (const [index, row] of status.entries()) {
      if (!isRecord(row) || typeof row['label'] !== 'string' || typeof row['value'] !== 'string') {
        return { ok: false, reason: `status[${String(index)}] 缺少 label 或 value` };
      }
    }
  }
  // The copy block's label and value are rendered verbatim; a malformed one is
  // refused here for the same reason a bad field is — the renderer indexes into
  // it without a guard.
  const copy = page['copy'];
  if (copy !== undefined) {
    if (!isRecord(copy)) return { ok: false, reason: 'copy 必须是对象' };
    if (typeof copy['label'] !== 'string' || typeof copy['value'] !== 'string') {
      return { ok: false, reason: 'copy 缺少 label 或 value' };
    }
    if (copy['hint'] !== undefined && typeof copy['hint'] !== 'string') {
      return { ok: false, reason: 'copy.hint 必须是字符串' };
    }
  }
  const fields = page['fields'];
  if (fields !== undefined) {
    if (!Array.isArray(fields)) return { ok: false, reason: 'fields 必须是数组' };
    for (const [index, field] of fields.entries()) {
      const why = fieldProblem(field);
      if (why !== null) return { ok: false, reason: `fields[${String(index)}] ${why}` };
    }
  }
  const actions = page['actions'];
  if (actions !== undefined) {
    if (!Array.isArray(actions)) return { ok: false, reason: 'actions 必须是数组' };
    for (const [index, action] of actions.entries()) {
      if (!isRecord(action) || typeof action['id'] !== 'string' || action['id'] === ''
        || typeof action['label'] !== 'string') {
        return { ok: false, reason: `actions[${String(index)}] 缺少 id 或 label` };
      }
    }
  }
  return { ok: true, page };
}

/** One field's defect, or null when the renderer can draw it. */
function fieldProblem(field: unknown): string | null {
  if (!isRecord(field)) return '不是对象';
  if (typeof field['key'] !== 'string' || field['key'] === '') return '缺少 key';
  if (typeof field['label'] !== 'string') return '缺少 label';
  if (typeof field['kind'] !== 'string' || !FIELD_KINDS.has(field['kind'])) return 'kind 不是四种可渲染类型之一';
  const options = field['options'];
  if (options !== undefined) {
    if (!Array.isArray(options)) return 'options 必须是数组';
    for (const option of options) {
      if (!isRecord(option) || typeof option['value'] !== 'string' || typeof option['label'] !== 'string') {
        return 'options 条目缺少 value 或 label';
      }
    }
  }
  return null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
