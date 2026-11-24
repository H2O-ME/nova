/**
 * Validators for the configured-hook vocabulary.
 *
 * Split from `hook-contract.ts` (the SHAPES) because the two answer different
 * questions and fail differently: a shape says what a hook IS, a validator says
 * whether one particular document is acceptable and, when it is not, where the
 * offending field is. Both config sources (the operator's `config.json` and a
 * pack's `hooks/hooks.json`) go through THESE functions, so one row means one
 * thing wherever it was written.
 */
import {
  isHookEventName,
  type HookDefinition,
  type HookEventsConfig,
  type HookMatcherGroup,
  type HooksConfig,
} from './hook-contract.js';

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validate an events table (the `hooks` object inside a pack's hooks.json, or
 * the `events` field of the operator's `hooks` config).
 *
 * `unknown` EXTRA keys are ignored, matching ZCode's forward compatibility (a
 * pack may carry a field a newer host understands); a malformed KNOWN key
 * refuses the whole table so a typo fails at load with the offending path
 * named instead of silently doing nothing.
 */
export function validateHookEvents(value: unknown): Validated<HookEventsConfig> {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'hooks 事件表必须是对象' };
  }
  const events: HookEventsConfig = {};
  for (const [eventName, groups] of Object.entries(value as Record<string, unknown>)) {
    // An unknown EVENT name is ignored, not refused: ZCode adds events over
    // time and an older host must still load a newer pack's other hooks.
    if (!isHookEventName(eventName)) continue;
    if (!Array.isArray(groups)) return { ok: false, error: `hooks.${eventName} 必须是数组` };
    const validated: HookMatcherGroup[] = [];
    for (const [index, group] of groups.entries()) {
      const checked = validateMatcherGroup(group, `hooks.${eventName}[${index}]`);
      if (!checked.ok) return checked;
      validated.push(checked.value);
    }
    if (validated.length > 0) events[eventName] = validated;
  }
  return { ok: true, value: events };
}

function validateMatcherGroup(value: unknown, where: string): Validated<HookMatcherGroup> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: `${where} 必须是对象` };
  }
  const record = value as Record<string, unknown>;
  if (record['matcher'] !== undefined && typeof record['matcher'] !== 'string') {
    return { ok: false, error: `${where}.matcher 必须是字符串` };
  }
  if (!Array.isArray(record['hooks']) || (record['hooks'] as unknown[]).length === 0) {
    return { ok: false, error: `${where}.hooks 必须是非空数组` };
  }
  const hooks: HookDefinition[] = [];
  for (const [index, def] of (record['hooks'] as unknown[]).entries()) {
    const checked = validateHookDefinition(def, `${where}.hooks[${index}]`);
    if (!checked.ok) return checked;
    hooks.push(checked.value);
  }
  return {
    ok: true,
    value: {
      ...(typeof record['matcher'] === 'string' ? { matcher: record['matcher'] } : {}),
      hooks,
    },
  };
}

function validateHookDefinition(value: unknown, where: string): Validated<HookDefinition> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: `${where} 必须是对象` };
  }
  const record = value as Record<string, unknown>;
  const type = record['type'];
  if (type !== 'process' && type !== 'command') {
    return { ok: false, error: `${where}.type 必须是 "process" 或 "command"` };
  }
  if (typeof record['command'] !== 'string' || (record['command'] as string).length === 0) {
    return { ok: false, error: `${where}.command 必须是非空字符串` };
  }
  const onError = record['onError'];
  if (onError !== undefined && onError !== 'allow' && onError !== 'deny') {
    return { ok: false, error: `${where}.onError 必须是 "allow" 或 "deny"` };
  }
  const timeoutMs = validatePositiveNumber(record['timeoutMs'], `${where}.timeoutMs`);
  if (!timeoutMs.ok) return timeoutMs;
  const statusMessage =
    typeof record['statusMessage'] === 'string' ? { statusMessage: record['statusMessage'] as string } : {};
  const onErrorField: { onError?: 'allow' | 'deny' } =
    onError === 'allow' || onError === 'deny' ? { onError } : {};
  const enabledField = record['enabled'] === false ? { enabled: false } : {};
  const timeoutField = timeoutMs.value !== undefined ? { timeoutMs: timeoutMs.value } : {};

  if (type === 'process') {
    if (record['args'] !== undefined && !Array.isArray(record['args'])) {
      return { ok: false, error: `${where}.args 必须是数组` };
    }
    const args = record['args'] === undefined ? {} : { args: (record['args'] as unknown[]).map(String) };
    return {
      ok: true,
      value: {
        type: 'process',
        command: record['command'] as string,
        ...args,
        ...statusMessage,
        ...onErrorField,
        ...enabledField,
        ...timeoutField,
      },
    };
  }
  const timeout = validatePositiveNumber(record['timeout'], `${where}.timeout`);
  if (!timeout.ok) return timeout;
  return {
    ok: true,
    value: {
      type: 'command',
      command: record['command'] as string,
      ...(timeout.value !== undefined ? { timeout: timeout.value } : {}),
      ...(record['async'] === true ? { async: true } : {}),
      ...(record['shell'] === true || typeof record['shell'] === 'string' ? { shell: record['shell'] } : {}),
      ...statusMessage,
      ...onErrorField,
      ...enabledField,
      ...timeoutField,
    },
  };
}

function validatePositiveNumber(value: unknown, where: string): Validated<number | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return { ok: false, error: `${where} 必须是正数` };
  }
  return { ok: true, value };
}

/**
 * Validate the operator's `hooks` config key.
 *
 * Strict on the WRAPPER's own fields: an unknown top-level key is a typo the
 * operator should see named (`hooks.timeouts` doing nothing is the failure mode
 * this session exists to remove). The events table inside follows
 * `validateHookEvents`, which ignores unknown keys there for pack
 * forward-compatibility.
 */
export function validateHooksConfig(value: unknown): Validated<HooksConfig> {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'hooks 配置必须是对象' };
  }
  const record = value as Record<string, unknown>;
  const known = new Set(['enabled', 'timeoutMs', 'maxOutputBytes', 'events']);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) return { ok: false, error: `hooks 配置出现未知键 "${key}"` };
  }
  if (record['enabled'] !== undefined && typeof record['enabled'] !== 'boolean') {
    return { ok: false, error: 'hooks.enabled 必须是布尔值' };
  }
  const timeoutMs = validatePositiveNumber(record['timeoutMs'], 'hooks.timeoutMs');
  if (!timeoutMs.ok) return timeoutMs;
  const maxOutputBytes = validatePositiveNumber(record['maxOutputBytes'], 'hooks.maxOutputBytes');
  if (!maxOutputBytes.ok) return maxOutputBytes;
  const events = validateHookEvents(record['events']);
  if (!events.ok) return events;
  return {
    ok: true,
    value: {
      ...(record['enabled'] === true ? { enabled: true } : {}),
      ...(timeoutMs.value !== undefined ? { timeoutMs: timeoutMs.value } : {}),
      ...(maxOutputBytes.value !== undefined ? { maxOutputBytes: maxOutputBytes.value } : {}),
      ...(Object.keys(events.value).length > 0 ? { events: events.value } : {}),
    },
  };
}
