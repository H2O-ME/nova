/**
 * The lifecycle events the configured-hook surface dispatches on.
 *
 * Split from `capabilities.ts` (which declares the capabilities a plugin can
 * REPLACE) because these four exist for a different reason: they are the
 * kernel's side of the ZCode hook event set, and their only intended listeners
 * are the configured-hook bridge and, occasionally, a first-party plugin that
 * needs the same boundary. Keeping them here means the capabilities file stays
 * a list of seams an operator can fill, while this file stays a list of moments
 * an extension can observe — two questions that were starting to share a file
 * only because both are "events".
 *
 * The remaining three ZCode events reuse existing keys (`beforeToolCall` =
 * PreToolUse, `afterToolResult` = PostToolUse, `beforeTurnEnd` = Stop), so the
 * name mapping is: capabilities.ts owns the three load-bearing ones with their
 * long-standing semantics; this file adds the four that had no key at all.
 */
import type {
  SessionStartContext,
  SessionStartOutcome,
  ToolCall,
  UserPromptSubmitContext,
  UserPromptSubmitVerdict,
} from '../types.js';
import type { PermissionRequestContext, PermissionRequestVerdict } from './hook-contract.js';
import { event, type EventKey } from './events.js';

/**
 * A session's first run is about to start. Configured-hook name: `SessionStart`
 * (the matcher is tested against `source`). Serial, first decisive verdict
 * wins: `{ additionalContext }` is appended as a context fragment before the
 * first request — the ZCode-compatible way a hook seeds guidance without
 * editing the operator's prompt.
 */
export const sessionStart: EventKey<[SessionStartContext], SessionStartOutcome | undefined> =
  event('session/start');

/**
 * A user prompt arrived, BEFORE it is committed to the log.
 * Configured-hook name: `UserPromptSubmit` (no matcher query; a group's matcher
 * never filters this event). Serial, first decisive verdict wins:
 * `{ action: 'block' }` rejects the prompt; `{ additionalContext }` rides ahead
 * of it as a context fragment.
 */
export const userPromptSubmit: EventKey<[UserPromptSubmitContext], UserPromptSubmitVerdict | undefined> =
  event('prompt/submit');

/**
 * The approval gate is about to ask a human. Configured-hook name:
 * `PermissionRequest` (matcher tested against the tool name). Serial, first
 * decisive verdict wins: `allow` / `deny` settles the call without publishing a
 * card; `ask` (and no answer) lets the gate proceed with its own ask. Fired by
 * the permission service itself, so only kernels that build one see it.
 */
export const permissionRequest: EventKey<[PermissionRequestContext], PermissionRequestVerdict | undefined> =
  event('permission/request');

/**
 * Failure twin of `tool/after`: fired when a call's result starts with the
 * `Error:` convention INSTEAD of the success waterfall, so a failure observer
 * never also fires on healthy results. Configured-hook name:
 * `PostToolUseFailure`; waterfall, same string shape.
 */
export const postToolUseFailure: EventKey<[ToolCall, string], string | undefined> =
  event('tool/after-failure');
