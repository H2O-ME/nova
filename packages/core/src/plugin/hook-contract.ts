/**
 * The configured-hook contract: the JSON surface operator-declared hooks share.
 *
 * A configured hook is a row in a config document (the operator's
 * `~/.nova/config.json` `hooks` key, or a plugin pack's `hooks/hooks.json`)
 * that runs an EXTERNAL process at one of seven lifecycle events, in the
 * ZCode/Claude shape: per event a list of matcher groups, each holding hook
 * definitions of type `process` (argv, no shell) or `command` (one shell
 * command line). Core owns this vocabulary so every reader — the CLI config
 * loader, the pack loader, the runner — validates the same shapes;
 * `plugins/hook-run.ts` owns execution, `plugins/hook-bridge.ts` owns bridging
 * outcomes onto the container's event keys.
 *
 * Event names keep the ZCode/Claude spelling because hooks are an ecosystem
 * surface: a pack written for ZCode (mimosa) must run unmodified. The mapping
 * onto this kernel's event keys sits with each key in `capabilities.ts`
 * (PreToolUse = `tool/before`, PostToolUse = `tool/after`, Stop =
 * `turn/before-end`).
 */
import type { ToolCall, ToolPermissionKind } from '../types.js';

/** The seven lifecycle events a configured hook can subscribe to (ZCode set). */
export const HOOK_EVENT_NAMES = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];

/**
 * The same seven names as a value, so a switch can name its cases.
 *
 * A const object rather than a TS enum: this package is ESM-only and emits no
 * runtime enums, and `HookEventName.PreToolUse` reads the same at the call
 * site — which is what keeps the ported ZCode code recognizable.
 */
export const HookEventName = {
  SessionStart: 'SessionStart',
  UserPromptSubmit: 'UserPromptSubmit',
  PreToolUse: 'PreToolUse',
  PermissionRequest: 'PermissionRequest',
  PostToolUse: 'PostToolUse',
  PostToolUseFailure: 'PostToolUseFailure',
  Stop: 'Stop',
} as const satisfies Record<HookEventName, HookEventName>;

export function isHookEventName(value: unknown): value is HookEventName {
  return typeof value === 'string' && (HOOK_EVENT_NAMES as readonly string[]).includes(value);
}

/** What a failed hook itself does to the call (only meaningful before a tool runs). */
export type HookOnError = 'allow' | 'deny';

/**
 * argv execution: `command` plus `args`, no shell interpolation. This is the
 * form machine-generated declarations (plugin packs) use — a command line
 * would re-parse through a shell and its quoting is another place a path with
 * spaces can break.
 */
export interface HookProcessDefinition {
  readonly type: 'process';
  readonly command: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly statusMessage?: string;
  readonly onError?: HookOnError;
  readonly enabled?: boolean;
}

/**
 * Shell execution: one command line. `timeout` (SECONDS, Claude spelling) is
 * accepted alongside `timeoutMs` so a Claude-compatible hooks.json loads
 * unchanged; the two never combine (`timeoutMs` wins only when `timeout` is
 * absent).
 */
export interface HookCommandDefinition {
  readonly type: 'command';
  readonly command: string;
  readonly timeout?: number;
  readonly timeoutMs?: number;
  readonly async?: boolean;
  readonly shell?: true | string;
  readonly statusMessage?: string;
  readonly onError?: HookOnError;
  readonly enabled?: boolean;
}

export type HookDefinition = HookProcessDefinition | HookCommandDefinition;

/**
 * One matcher group: the hooks it holds run only for subjects the matcher
 * accepts. For tool events the subject is the tool name; `SessionStart`
 * matches its `source`; the remaining events have no subject, so a matcher
 * there never filters (it still runs — ZCode semantics, kept so a pack can
 * carry the same group shape across events).
 */
export interface HookMatcherGroup {
  readonly matcher?: string;
  readonly hooks: readonly HookDefinition[];
}

/** The events table both config sources share. */
export type HookEventsConfig = Partial<Record<HookEventName, readonly HookMatcherGroup[]>>;

/**
 * The operator's `hooks` key in `~/.nova/config.json`. Off by default
 * (`enabled` must be explicitly true) because a configured hook is an
 * execution bypass: it runs whatever command the document names, with the
 * operator's permissions, before the kernel can reason about it.
 */
export interface HooksConfig {
  readonly enabled?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly events?: HookEventsConfig;
}

export const DEFAULT_HOOK_TIMEOUT_MS = 60_000;
export const DEFAULT_HOOK_MAX_OUTPUT_BYTES = 32_768;

/* ── payload (stdin) ────────────────────────────────────────────────────── */

/**
 * What the runner hands a hook on stdin: one JSON object, serialized with
 * BOTH the snake_case (Claude-compatible packs) and camelCase (ZCode-native
 * packs) spellings of every field, so a pack written for either reads its
 * fields without a fork.
 *
 * Field names follow ZCode's `HookInput` + `createCompatibleHookStdin`; the
 * transient `transcript.jsonl` a Claude hook may read IS produced (Stop gets
 * the last assistant message, UserPromptSubmit the prompt, others an empty
 * readable file) because packs do read it.
 */
export interface HookPayload {
  readonly sessionId?: string;
  readonly transcriptPath?: string;
  readonly cwd: string;
  readonly hookEventName: HookEventName;
  /** The Claude-compatible alias ZCode keeps alongside `agentName`. */
  readonly agentName?: string;
  readonly permissionMode?: string;
  readonly toolName?: string;
  readonly toolInput?: unknown;
  readonly toolCallId?: string;
  /** PostToolUse: the tool's full structured output. */
  readonly toolResponse?: unknown;
  /** PostToolUseFailure: the failure text and whether the user interrupted. */
  readonly error?: string;
  readonly isInterrupt?: boolean;
  readonly permissionSuggestions?: unknown;
  readonly prompt?: string;
  readonly source?: 'startup' | 'resume';
  readonly stopHookActive?: boolean;
  /** Stop: the assistant text the turn is ending on. */
  readonly responseText?: string;
}

/**
 * Serialize one payload to the single-line JSON a hook reads.
 *
 * Every field is written twice (camel + snake) exactly like ZCode's
 * `createCompatibleHookStdin`, plus the ZCode-only `additional_context`
 * spelling on the output side. A field the event does not carry is omitted
 * rather than sent as null: a hook that checks `'tool_name' in input` must see
 * the truth.
 */
export function serializeHookPayload(payload: HookPayload): string {
  const pairs: Array<[string, string, unknown]> = [
    ['sessionId', 'session_id', payload.sessionId],
    ['transcriptPath', 'transcript_path', payload.transcriptPath],
    ['hookEventName', 'hook_event_name', payload.hookEventName],
    ['agentName', 'agent_type', payload.agentName],
    ['permissionMode', 'permission_mode', payload.permissionMode],
    ['toolName', 'tool_name', payload.toolName],
    ['toolInput', 'tool_input', payload.toolInput],
    ['toolCallId', 'tool_use_id', payload.toolCallId],
    ['toolResponse', 'tool_response', payload.toolResponse],
    ['error', 'error', payload.error],
    ['isInterrupt', 'is_interrupt', payload.isInterrupt],
    ['permissionSuggestions', 'permission_suggestions', payload.permissionSuggestions],
    ['prompt', 'prompt', payload.prompt],
    ['source', 'source', payload.source],
    ['stopHookActive', 'stop_hook_active', payload.stopHookActive],
    ['responseText', 'last_assistant_message', payload.responseText],
  ];
  const record: Record<string, unknown> = { cwd: payload.cwd };
  for (const [camel, snake, value] of pairs) {
    if (value === undefined) continue;
    record[camel] = value;
    record[snake] = value;
  }
  return JSON.stringify(record);
}

/* ── outcome (stdout + exit code) ───────────────────────────────────────── */

/** The permission answer one tool-call hook may give. */
export type HookPermissionDecision = 'allow' | 'ask' | 'deny';

/**
 * A PermissionRequest hook's structured `decision` — an OBJECT, not a string
 * (ZCode's `PermissionRequestHookDecisionSchema`). Both `permissionUpdates`
 * (ZCode's name) and `updatedPermissions` (Claude's) are accepted; the fields
 * are carried through untouched and consumed by whoever owns the grant store.
 */
export interface PermissionRequestHookDecision {
  readonly behavior: 'allow' | 'deny';
  readonly message?: string;
  readonly updatedInput?: unknown;
  readonly permissionUpdates?: unknown;
  readonly updatedPermissions?: unknown;
}

/**
 * The per-event `hookSpecificOutput`. A DISCRIMINATED union on
 * `hookEventName`, exactly as ZCode declares it: each event's block may carry
 * `additionalContext`, and only the events that can decide anything carry more.
 * `hookEventName` must equal the event being dispatched — a mismatch makes the
 * hook FAIL, it is not silently applied.
 */
export type HookSpecificOutput =
  | {
      readonly hookEventName: 'PreToolUse';
      readonly permissionDecision?: HookPermissionDecision;
      readonly permissionDecisionReason?: string;
      readonly updatedInput?: unknown;
      readonly additionalContext?: string;
    }
  | { readonly hookEventName: 'PermissionRequest'; readonly decision?: PermissionRequestHookDecision }
  | { readonly hookEventName: 'UserPromptSubmit'; readonly additionalContext?: string }
  | { readonly hookEventName: 'SessionStart'; readonly additionalContext?: string }
  | { readonly hookEventName: 'PostToolUse'; readonly additionalContext?: string }
  | { readonly hookEventName: 'PostToolUseFailure'; readonly additionalContext?: string }
  | { readonly hookEventName: 'Stop'; readonly additionalContext?: string };

/**
 * What a hook may answer on stdout (ZCode's `HookJSONOutputSchema`).
 *
 * `decision` is the cross-host enum; `continue:false` blocks (except on Stop);
 * `stopReason` is the longer explanation; `systemMessage` is surfaced to the
 * operator; `additional_context` is the snake_case twin. Unknown keys are
 * ignored — a pack may target a richer host — but a known key with the wrong
 * type fails the hook rather than half-applying.
 */
export interface HookOutput {
  readonly decision?: 'approve' | 'block';
  readonly reason?: string;
  readonly continue?: boolean;
  readonly stopReason?: string;
  readonly suppressOutput?: boolean;
  readonly systemMessage?: string;
  readonly additionalContext?: string;
  readonly additional_context?: string;
  readonly hookSpecificOutput?: HookSpecificOutput;
}

/**
 * Parse one hook's stdout.
 *
 * ZCode's rules, kept exactly:
 *  - empty stdout, or output not starting with `{`, is "nothing actionable"
 *    (a hook that prints diagnostics is an observer, not a failure);
 *  - malformed JSON is also nothing actionable — a log line must not fail the
 *    action;
 *  - valid JSON with a KNOWN field of the wrong type, or a
 *    `hookSpecificOutput.hookEventName` naming another event, THROWS: that is
 *    a contract violation and the caller records the hook as failed (isolated
 *    from the other hooks of the same event).
 * @param raw - the captured stdout.
 * @returns the parsed output, or undefined when there is nothing actionable.
 */
export function parseHookOutput(raw: string): HookOutput | undefined {
  const text = raw.trim();
  if (text.length === 0 || !text.startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const out: {
    decision?: 'approve' | 'block';
    reason?: string;
    continue?: boolean;
    stopReason?: string;
    suppressOutput?: boolean;
    systemMessage?: string;
    additionalContext?: string;
    additional_context?: string;
    hookSpecificOutput?: HookSpecificOutput;
  } = {};

  if (record['decision'] !== undefined) {
    if (record['decision'] !== 'approve' && record['decision'] !== 'block') {
      throw new Error(`hook stdout: decision must be "approve" or "block", got ${JSON.stringify(record['decision'])}`);
    }
    out.decision = record['decision'];
  }
  for (const key of ['reason', 'stopReason', 'systemMessage', 'additionalContext', 'additional_context'] as const) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error(`hook stdout: ${key} must be a string`);
    (out as Record<string, unknown>)[key] = value;
  }
  if (record['continue'] !== undefined) {
    if (typeof record['continue'] !== 'boolean') throw new Error('hook stdout: continue must be a boolean');
    out.continue = record['continue'];
  }
  if (record['suppressOutput'] !== undefined) {
    if (typeof record['suppressOutput'] !== 'boolean') throw new Error('hook stdout: suppressOutput must be a boolean');
    if (record['suppressOutput'] === true) out.suppressOutput = true;
  }
  const specific = record['hookSpecificOutput'];
  if (specific !== undefined) {
    out.hookSpecificOutput = parseSpecificOutput(specific);
  }
  return hasActionable(out) ? out : undefined;
}

function hasActionable(out: HookOutput): boolean {
  return (
    out.decision !== undefined ||
    out.reason !== undefined ||
    out.continue !== undefined ||
    out.stopReason !== undefined ||
    out.systemMessage !== undefined ||
    out.suppressOutput !== undefined ||
    out.additionalContext !== undefined ||
    out.additional_context !== undefined ||
    out.hookSpecificOutput !== undefined
  );
}

/** One event's `hookSpecificOutput`, validated per the discriminated union. */
function parseSpecificOutput(value: unknown): HookSpecificOutput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('hook stdout: hookSpecificOutput must be an object');
  }
  const spec = value as Record<string, unknown>;
  const event = spec['hookEventName'];
  if (!isHookEventName(event)) {
    throw new Error(
      `hook stdout: hookSpecificOutput.hookEventName must be one of ${HOOK_EVENT_NAMES.join(', ')}, got ${JSON.stringify(event)}`,
    );
  }
  const context = stringField(spec['additionalContext'], 'hookSpecificOutput.additionalContext');

  switch (event) {
    case 'PreToolUse': {
      const decision = spec['permissionDecision'];
      if (decision !== undefined && decision !== 'allow' && decision !== 'ask' && decision !== 'deny') {
        throw new Error(
          `hook stdout: permissionDecision must be "allow" | "ask" | "deny", got ${JSON.stringify(decision)}`,
        );
      }
      return {
        hookEventName: event,
        ...(decision !== undefined ? { permissionDecision: decision } : {}),
        ...(stringField(spec['permissionDecisionReason'], 'hookSpecificOutput.permissionDecisionReason') !== undefined
          ? { permissionDecisionReason: spec['permissionDecisionReason'] as string }
          : {}),
        ...('updatedInput' in spec && spec['updatedInput'] !== undefined ? { updatedInput: spec['updatedInput'] } : {}),
        ...(context !== undefined ? { additionalContext: context } : {}),
      };
    }
    case 'PermissionRequest': {
      const decision = spec['decision'];
      if (decision === undefined) return { hookEventName: event };
      return { hookEventName: event, decision: parsePermissionDecision(decision) };
    }
    default:
      return { hookEventName: event, ...(context !== undefined ? { additionalContext: context } : {}) };
  }
}

/** The PermissionRequest `decision` OBJECT (ZCode's union, allow | deny). */
function parsePermissionDecision(value: unknown): PermissionRequestHookDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('hook stdout: PermissionRequest decision must be an object');
  }
  const record = value as Record<string, unknown>;
  const behavior = record['behavior'];
  if (behavior !== 'allow' && behavior !== 'deny') {
    throw new Error(`hook stdout: PermissionRequest decision.behavior must be "allow" or "deny", got ${JSON.stringify(behavior)}`);
  }
  return {
    behavior,
    ...(typeof record['message'] === 'string' ? { message: record['message'] } : {}),
    ...('updatedInput' in record && record['updatedInput'] !== undefined ? { updatedInput: record['updatedInput'] } : {}),
    ...(record['permissionUpdates'] !== undefined ? { permissionUpdates: record['permissionUpdates'] } : {}),
    ...(record['updatedPermissions'] !== undefined ? { updatedPermissions: record['updatedPermissions'] } : {}),
  };
}

function stringField(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`hook stdout: ${where} must be a string`);
  return value;
}

/** Exit-code semantics (ZCode): 0 = read stdout, 2 = block, anything else = the hook failed. */
export const HOOK_BLOCK_EXIT_CODE = 2;

/* ── matcher ────────────────────────────────────────────────────────────── */

const PLAIN_NAME = /^[A-Za-z0-9_|]+$/;

/**
 * Whether one matcher group applies to a subject.
 *
 * Absent / empty / `*` matches everything; a string of plain name characters
 * is an exact-name list joined by `|` (ZCode's fast path — and the reason
 * `Edit|Write|MultiEdit` is not treated as a regex); anything else is a JS
 * regex, and an INVALID regex disables the group with a diagnostic rather
 * than throwing — one broken matcher must not take the event down.
 */
export function hookMatches(matcher: string | undefined, subject: string | undefined): boolean {
  const pattern = matcher?.trim();
  if (pattern === undefined || pattern.length === 0 || pattern === '*') return true;
  if (subject === undefined) return true;
  if (PLAIN_NAME.test(pattern)) {
    return pattern.split('|').some((name) => name === subject);
  }
  try {
    return new RegExp(pattern).test(subject);
  } catch {
    return false;
  }
}

/* ── runtime outcome shape (shared by runner and bridge) ───────────────── */

/**
 * One hook's run, as the runner reports it.
 *
 * `failure` covers "the process did not run correctly" (non-zero exit other
 * than 2, timeout, spawn error, cancelled). `outputError` covers "the process
 * ran and answered with something we cannot apply" (a bad known field, a
 * hookSpecificOutput for another event) — ZCode treats that as a hook FAILURE
 * too, isolated from the other hooks of the event.
 */
export interface HookRunOutcome {
  /** The exit code the process ended with (null on timeout / spawn failure). */
  readonly exitCode: number | null;
  /** stdout as captured (already truncated to the output cap). */
  readonly stdout: string;
  /** stderr, trimmed for diagnostics (never enters the model's context). */
  readonly stderr: string;
  /** The parsed actionable output, if any. */
  readonly output: HookOutput | undefined;
  /** The process did not complete correctly. */
  readonly failure: string | undefined;
  /** The output could not be applied (bad known field / wrong event name). */
  readonly outputError: string | undefined;
  /** The definition asked for fire-and-forget (`command.async`). */
  readonly async: boolean;
}

/** What a permission-request hook decided, in the approval gate's vocabulary. */
export interface PermissionRequestVerdict {
  readonly decision: 'allow' | 'deny' | 'ask';
  readonly reason?: string;
  /** The call's arguments the hook replaced (allow only, per ZCode's table). */
  readonly updatedInput?: unknown;
}

/** Context the approval gate passes to permission-request listeners. */
export interface PermissionRequestContext {
  readonly sessionId: string | undefined;
  readonly toolName: string;
  readonly kind: ToolPermissionKind;
  readonly call: ToolCall;
}
