/**
 * Hook stdout → what the event should do. The port of ZCode's
 * `core/src/hooks/output.ts`, kept shape-for-shape so a pack written against
 * ZCode's contract means the same thing here.
 *
 * Ported from ZCode (`apps/zcode-cli/packages/core/src/hooks/output.ts`,
 * Apache-2.0, © Z.ai), rewritten for this repo's types and naming.
 *
 * ## The shape that matters
 *
 * `HookRunResult` is the ACCUMULATOR across every hook of one event: hooks run
 * in order and their outputs merge (deny beats ask beats allow; the last
 * `updatedInput` wins). Keeping this as one object — rather than applying each
 * hook directly — is what makes "several hooks answered one event" defined.
 */
import {
  HookEventName,
  type HookOutput,
  type HookPermissionDecision,
  type HookSpecificOutput,
} from './hook-contract.js';

/** One hook's opinion about an event, after parsing. */
export interface HookRunResult {
  /** Text the model should see, in hook order (a blank line joins them). */
  additionalContexts: string[];
  /** The event wants to stop what it was about to do. */
  blockRequested?: boolean;
  /** Why — surfaces it and feeds it to the model. */
  stopReason?: string;
  /**
   * The effective permission answer for a tool call. `deny` > `ask` > `allow`:
   * one hook may not widen another's decision.
   */
  permissionBehavior?: HookPermissionDecision;
  /** The reason string a PreToolUse hook gave alongside its decision. */
  hookPermissionDecisionReason?: string;
  /** A PermissionRequest hook's structured decision (ZCode's object form). */
  permissionRequestResult?: {
    behavior: 'allow' | 'deny';
    message?: string;
    updatedInput?: unknown;
  };
  /** The call must not continue at all (prompt rejected, turn ended). */
  preventContinuation?: boolean;
  /** Stop only: the hook asked for another turn. */
  stopShouldContinue?: boolean;
  /** PreToolUse only: the arguments the hook replaced. */
  updatedInput?: unknown;
}

/** A PermissionRequest hook's `decision` object, as ZCode defines it. */
export interface PermissionRequestDecision {
  readonly behavior: 'allow' | 'deny';
  readonly message?: string;
  readonly updatedInput?: unknown;
  readonly permissionUpdates?: unknown;
  readonly updatedPermissions?: unknown;
}

/**
 * Read one hook's parsed stdout into an opinion. `expectedEvent` decides which
 * fields mean what: the SAME `decision: "block"` blocks a tool and asks for
 * another turn on Stop.
 *
 * A `hookSpecificOutput` naming a DIFFERENT event throws: the hook answered
 * about something that is not happening, and silently applying it would move
 * one event's decision onto another.
 * @param expectedEvent - the event being dispatched.
 * @param output - the parsed stdout, or undefined for "no output".
 * @returns the accumulated opinion for this hook.
 */
export function processHookOutput(expectedEvent: HookEventName, output: HookOutput | undefined): HookRunResult {
  const result: HookRunResult = { additionalContexts: [] };
  if (output === undefined) return result;

  // `continue: false` stops whatever was about to happen — except on Stop,
  // where it is meaningless (the turn is already ending).
  if (output.continue === false && expectedEvent !== HookEventName.Stop) {
    result.blockRequested = true;
    result.stopReason = output.stopReason ?? output.reason;
    if (shouldPreventContinuation(expectedEvent)) result.preventContinuation = true;
    if (isPermissionEvent(expectedEvent)) result.permissionBehavior = 'deny';
  }
  // Stop's continue:true (with or without context) means "run another turn".
  if (expectedEvent === HookEventName.Stop && output.continue === true) {
    result.stopShouldContinue = true;
    result.stopReason = output.stopReason ?? output.reason;
  }
  if (output.decision === 'approve' && isPermissionEvent(expectedEvent)) {
    result.permissionBehavior = 'allow';
  }
  if (output.decision === 'block') {
    result.blockRequested = true;
    result.stopReason = output.stopReason ?? output.reason ?? output.systemMessage;
    if (isPermissionEvent(expectedEvent)) result.permissionBehavior = 'deny';
    if (shouldPreventContinuation(expectedEvent)) result.preventContinuation = true;
    if (expectedEvent === HookEventName.Stop) {
      result.stopShouldContinue = true;
      if (output.systemMessage !== undefined) result.additionalContexts.push(output.systemMessage);
      if (output.reason !== undefined) result.additionalContexts.push(output.reason);
    }
  }
  if (output.additionalContext !== undefined) result.additionalContexts.push(output.additionalContext);
  if (output.additional_context !== undefined) result.additionalContexts.push(output.additional_context);

  const specific = output.hookSpecificOutput;
  if (specific === undefined) return result;
  if (specific.hookEventName !== undefined && specific.hookEventName !== expectedEvent) {
    throw new Error(
      `hook answered for "${specific.hookEventName}" while "${expectedEvent}" was dispatching`,
    );
  }
  applySpecificOutput(result, specific);
  return result;
}

/** Fold one hook's opinion into the event's accumulator. */
export function mergeHookRunResult(target: HookRunResult, next: HookRunResult): void {
  target.additionalContexts.push(...next.additionalContexts);
  if (next.blockRequested === true) {
    target.blockRequested = true;
    target.stopReason = next.stopReason ?? target.stopReason;
  }
  if (next.preventContinuation === true) {
    target.preventContinuation = true;
    target.stopReason = next.stopReason;
  }
  if (next.stopShouldContinue !== undefined) {
    target.stopShouldContinue = next.stopShouldContinue;
    target.stopReason = next.stopReason ?? target.stopReason;
  }
  if (next.updatedInput !== undefined) target.updatedInput = next.updatedInput;
  if (next.permissionRequestResult !== undefined) target.permissionRequestResult = next.permissionRequestResult;
  if (next.hookPermissionDecisionReason !== undefined) {
    target.hookPermissionDecisionReason = next.hookPermissionDecisionReason;
  }
  if (next.permissionBehavior !== undefined) {
    target.permissionBehavior = mergePermissionBehavior(target.permissionBehavior, next.permissionBehavior);
  }
}

/** deny beats ask beats allow: one hook may never widen another's answer. */
function mergePermissionBehavior(
  current: HookPermissionDecision | undefined,
  next: HookPermissionDecision,
): HookPermissionDecision {
  if (current === 'deny' || next === 'deny') return 'deny';
  if (current === 'ask' || next === 'ask') return 'ask';
  return next;
}

function isPermissionEvent(event: HookEventName): boolean {
  return event === HookEventName.PreToolUse || event === HookEventName.PermissionRequest;
}

function shouldPreventContinuation(event: HookEventName): boolean {
  return (
    event === HookEventName.PreToolUse ||
    event === HookEventName.PermissionRequest ||
    event === HookEventName.UserPromptSubmit
  );
}

function applySpecificOutput(result: HookRunResult, specific: HookSpecificOutput): void {
  switch (specific.hookEventName) {
    case HookEventName.PreToolUse:
      if (specific.permissionDecision !== undefined) {
        result.permissionBehavior = specific.permissionDecision;
        result.hookPermissionDecisionReason = specific.permissionDecisionReason;
      }
      if ('updatedInput' in specific && specific.updatedInput !== undefined) {
        result.updatedInput = specific.updatedInput;
      }
      if (specific.additionalContext !== undefined) result.additionalContexts.push(specific.additionalContext);
      break;
    case HookEventName.PermissionRequest:
      if (specific.decision !== undefined) {
        result.permissionRequestResult = {
          behavior: specific.decision.behavior,
          ...(specific.decision.message !== undefined ? { message: specific.decision.message } : {}),
          ...(specific.decision.updatedInput !== undefined ? { updatedInput: specific.decision.updatedInput } : {}),
        };
        // The structured decision IS the permission answer.
        result.permissionBehavior = specific.decision.behavior;
        if (specific.decision.message !== undefined) result.hookPermissionDecisionReason = specific.decision.message;
      }
      break;
    case HookEventName.Stop:
    case HookEventName.PostToolUse:
    case HookEventName.PostToolUseFailure:
    case HookEventName.UserPromptSubmit:
    case HookEventName.SessionStart:
      if (specific.additionalContext !== undefined) result.additionalContexts.push(specific.additionalContext);
      break;
  }
}

/**
 * What an EXIT CODE 2 means, expressed as output — the one place that turns
 * "the process said no" into the event's own vocabulary. Ported from ZCode's
 * `createExitCodeBlockOutput`, which exists so a hook that only knows exit
 * codes (a plain shell guard) can block without speaking JSON.
 */
export function exitCodeBlockOutput(event: HookEventName, reason: string): HookOutput {
  if (event === HookEventName.PreToolUse) {
    return {
      continue: false,
      reason,
      hookSpecificOutput: {
        hookEventName: HookEventName.PreToolUse,
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
  }
  if (event === HookEventName.PermissionRequest) {
    return {
      continue: false,
      reason,
      hookSpecificOutput: {
        hookEventName: HookEventName.PermissionRequest,
        decision: { behavior: 'deny', message: reason },
      },
    };
  }
  if (event === HookEventName.Stop) return { decision: 'block', reason };
  return { continue: false, reason };
}
