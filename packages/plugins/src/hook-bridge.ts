/**
 * The declarative-hook bridge: operator- and pack-declared JSON hooks, mapped
 * onto this kernel's event keys.
 *
 * A configured hook is not a plugin — it is a ROW in a config document that
 * names an external command. This module is the ONE adapter that makes such a
 * row behave like a plugin: it subscribes to the container's lifecycle events,
 * runs the matching external hooks in order, and translates their outputs into
 * the verdict shapes those events already speak.
 *
 * ## Why a bridge instead of a second dispatcher
 *
 * The container already owns the event chain (`ctx.serial` / `ctx.waterfall`,
 * priority, first-decisive-wins) and the loader already owns lifetimes. A
 * second dispatch path for "configured" hooks would duplicate both and let them
 * diverge. So the bridge holds no state beyond its table.
 *
 * ## Aggregation, not one-hook-wins
 *
 * Hooks are accumulated through `processHookOutput` + `mergeHookRunResult`
 * (ZCode's model), NOT "first decisive verdict wins": every matching hook runs,
 * and deny beats ask beats allow. That is what makes two guards on one tool
 * both effective instead of the first one masking the second.
 *
 * ## Event mapping (ZCode names → this kernel's keys)
 *
 *   SessionStart       → sessionStart       additionalContext seeds the session
 *   UserPromptSubmit   → userPromptSubmit   continue:false / decision:block rejects it
 *   PreToolUse         → beforeToolCall     permissionDecision + updatedInput
 *   PermissionRequest  → permissionRequest  the gate's pre-answer (structured object)
 *   PostToolUse        → afterToolResult    additionalContext rides as an attachment
 *   PostToolUseFailure → postToolUseFailure same, failure twin
 *   Stop               → beforeTurnEnd      decision:block asks for another turn
 *
 * ## Failure policy (ZCode's, exactly)
 *
 * `onError: "deny"` applies ONLY to PreToolUse. Everywhere else a failed hook
 * fails OPEN (the action proceeds) and is logged — a guard that breaks must not
 * silently become a wall. A user cancellation is never a failure.
 */
import {
  afterToolResult as afterToolResultEvent,
  beforeToolCall as beforeToolCallEvent,
  beforeTurnEnd as beforeTurnEndEvent,
  exitCodeBlockOutput,
  hookMatches,
  mergeHookRunResult,
  permissionRequest as permissionRequestEvent,
  postToolUseFailure as postToolUseFailureEvent,
  processHookOutput,
  sessionStart as sessionStartEvent,
  userPromptSubmit as userPromptSubmitEvent,
  type BeforeTurnEndContext,
  type BeforeTurnEndVerdict,
  type Context,
  type HookDefinition,
  type HookEventName,
  type HookEventsConfig,
  type HookRunOutcome,
  type HookRunResult,
  type Listener,
  type PermissionRequestContext,
  type PermissionRequestVerdict,
  type Plugin,
  type SessionStartContext,
  type SessionStartOutcome,
  type ToolCall,
  type ToolCallScope,
  type ToolCallVerdict,
  type UserPromptSubmitContext,
  type UserPromptSubmitVerdict,
} from '@nova-agent/core';
import { runHook, type HookEnvironment } from './hook-run.js';

/** One source of configured hooks: the operator's config, or one loaded pack. */
export interface HookSource {
  /** Stable label for diagnostics (a config path or `pack:<name>`). */
  readonly label: string;
  readonly events: HookEventsConfig;
  /** Where `${*_PLUGIN_ROOT}` points for this source. */
  readonly pluginRoot?: string;
  /** Where `${*_PLUGIN_DATA}` points (a pack's writable data dir). */
  readonly pluginData?: string;
  /** Pack `userConfig` values, exposed to the hook as `${NAME}`. */
  readonly vars?: Readonly<Record<string, string>>;
}

export interface HookBridgeOptions {
  readonly sources: readonly HookSource[];
  readonly projectDir: () => string;
  readonly sessionId?: () => string | undefined;
  readonly defaultTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  /** Reports a hook that failed to run (never throws). */
  readonly onDiagnostic?: (message: string) => void;
}

/** One dispatch: which event, and the facts that event carries. */
interface Trigger {
  readonly event: HookEventName;
  /** The value a matcher is tested against (tool name, or `source`). */
  readonly subject?: string;
  readonly tool?: ToolCall;
  readonly toolResult?: string;
  readonly prompt?: string;
  readonly responseText?: string;
  readonly stopHookActive?: boolean;
  readonly sessionId?: string;
}

/** Separator between contributors (a blank line: distinct paragraphs). */
const SEP = String.fromCharCode(10, 10);

/** Stop's runaway guard: a hook may ask for at most this many extra turns (ZCode's cap). */
const STOP_CONTINUE_LIMIT = 3;

export function hookBridgePlugin(options: HookBridgeOptions): Plugin {
  // Per-session count of Stop continuations, so two sessions cannot exhaust each
  // other's budget and a persisted conversation keeps its own count.
  const stopContinues = new Map<string, number>();

  return {
    name: 'hook-bridge',
    description: 'Runs operator- and pack-declared lifecycle hooks (external commands) at the seven ZCode events.',
    manifest: {
      title: '生命周期钩子',
      description: '把配置与插件包声明的外部命令钩子接到会话与工具生命周期上。',
      tier: 'core',
    },
    apply: (ctx: Context): void => {
      const projectDir = (): string => options.projectDir();
      const currentSession = (explicit?: string): string | undefined => explicit ?? options.sessionId?.();

      /** Every (source, definition) that applies to one event, in declaration order. */
      const matchesFor = (
        event: HookEventName,
        subject?: string,
      ): Array<{ source: HookSource; def: HookDefinition }> => {
        const out: Array<{ source: HookSource; def: HookDefinition }> = [];
        for (const source of options.sources) {
          for (const group of source.events[event] ?? []) {
            if (!hookMatches(group.matcher, subject)) continue;
            for (const def of group.hooks) {
              // `enabled: false` is a real skip, not a UI dim: the row must not run.
              if (def.enabled === false) continue;
              out.push({ source, def });
            }
          }
        }
        return out;
      };

      const envFor = (source: HookSource, sessionId: string | undefined): HookEnvironment => ({
        projectDir: projectDir(),
        ...(source.pluginRoot !== undefined ? { pluginRoot: source.pluginRoot } : {}),
        ...(source.pluginData !== undefined ? { pluginData: source.pluginData } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
      });

      /**
       * Run every hook for one event and fold their outputs into one result.
       *
       * Each hook is isolated: a failure (process error / bad output) marks THAT
       * hook failed and the loop continues — ZCode's "failure is isolated from
       * other hooks" rule. A cancelled hook is not a failure.
       */
      const dispatch = async (trigger: Trigger): Promise<{ result: HookRunResult; failedOnDeny: boolean }> => {
        const matches = matchesFor(trigger.event, trigger.subject);
        const result: HookRunResult = { additionalContexts: [] };
        let failedOnDeny = false;
        if (matches.length === 0) return { result, failedOnDeny };

        const sessionId = currentSession(trigger.sessionId);
        const payload = {
          cwd: projectDir(),
          hookEventName: trigger.event,
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(trigger.subject !== undefined ? { toolName: trigger.subject } : {}),
          ...(trigger.tool !== undefined
            ? { toolInput: trigger.tool.args, toolCallId: trigger.tool.id }
            : {}),
          ...(trigger.toolResult !== undefined ? { toolResponse: trigger.toolResult } : {}),
          ...(trigger.prompt !== undefined ? { prompt: trigger.prompt } : {}),
          ...(trigger.responseText !== undefined ? { responseText: trigger.responseText } : {}),
          ...(trigger.stopHookActive !== undefined ? { stopHookActive: trigger.stopHookActive } : {}),
          ...(trigger.event === 'SessionStart' && trigger.subject !== undefined
            ? { source: trigger.subject as 'startup' | 'resume' }
            : {}),
        };

        for (const { source, def } of matches) {
          const outcome = await runHook(def, {
            env: envFor(source, sessionId),
            payload,
            ...(options.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: options.defaultTimeoutMs } : {}),
            ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
            ...(source.vars !== undefined ? { vars: source.vars } : {}),
          });
          // A fire-and-forget hook's output must not change what already moved on.
          if (outcome.async) {
            if (outcome.failure !== undefined) reportFailure(source, def, trigger, outcome);
            continue;
          }
          const failed = outcome.failure ?? outcome.outputError;
          if (failed !== undefined) {
            reportFailure(source, def, trigger, outcome);
            // onError:deny is PreToolUse-only (ZCode); the caller renders the deny.
            if (def.onError === 'deny' && trigger.event === 'PreToolUse') failedOnDeny = true;
            continue;
          }
          // Exit code 2 blocks in the event's own vocabulary, merged BEFORE the
          // parsed output so an explicit `updatedInput` still wins.
          if (outcome.exitCode === 2) {
            mergeHookRunResult(result, processHookOutput(trigger.event, exitCodeBlockOutput(trigger.event, blockReasonOf(outcome))));
          }
          const processed = processHookOutput(trigger.event, outcome.output);
          mergeHookRunResult(result, processed);
        }
        return { result, failedOnDeny };
      };

      const reportFailure = (
        source: HookSource,
        def: HookDefinition,
        trigger: Trigger,
        outcome: HookRunOutcome,
      ): void => {
        const reason = outcome.failure ?? outcome.outputError ?? 'unknown error';
        options.onDiagnostic?.(
          `hook ${def.type} "${def.command}" (${trigger.event}, ${source.label}) failed: ${reason}`,
        );
        // A failed hook's output may still carry context (ZCode: "the three
        // early-exit paths must not drop already-produced additionalContext").
        void outcome;
      };

      /* SessionStart → sessionStart */
      const onSessionStart: Listener<[SessionStartContext], SessionStartOutcome | undefined> = async (startCtx) => {
        const { result } = await dispatch({
          event: 'SessionStart',
          subject: startCtx.source,
          sessionId: startCtx.sessionId,
        });
        const text = joinContexts(result.additionalContexts);
        return text === undefined ? undefined : { additionalContext: text };
      };
      ctx.on(sessionStartEvent, onSessionStart);

      /* UserPromptSubmit → userPromptSubmit */
      const onUserPrompt: Listener<[UserPromptSubmitContext], UserPromptSubmitVerdict | undefined> = async (promptCtx) => {
        const { result } = await dispatch({
          event: 'UserPromptSubmit',
          prompt: promptCtx.prompt,
          sessionId: promptCtx.sessionId,
        });
        if (result.blockRequested === true || result.preventContinuation === true) {
          return { action: 'block', ...(result.stopReason !== undefined ? { reason: result.stopReason } : {}) };
        }
        const text = joinContexts(result.additionalContexts);
        return text === undefined ? undefined : { additionalContext: text };
      };
      ctx.on(userPromptSubmitEvent, onUserPrompt);

      /* PreToolUse → beforeToolCall */
      const onPreTool: Listener<[ToolCall, ToolCallScope], ToolCallVerdict | undefined> = async (call, scope) => {
        const { result, failedOnDeny } = await dispatch({
          event: 'PreToolUse',
          subject: call.name,
          tool: call,
          sessionId: scope.sessionId,
        });
        // deny beats ask beats allow — applyPermissionContract decides.
        if (result.permissionBehavior === 'deny' || failedOnDeny) {
          const reason =
            result.hookPermissionDecisionReason ??
            result.stopReason ??
            (failedOnDeny ? 'a PreToolUse hook failed and is configured onError: deny' : 'denied by a PreToolUse hook');
          return { action: 'deny', reason };
        }
        // `ask` means "let the gate ask": returning undefined passes the chain,
        // which is what makes the approval gate (priority 1000) the one that
        // prompts — the hook does not pre-answer.
        if (result.permissionBehavior === 'ask') return undefined;
        if (result.updatedInput !== undefined) {
          const updated = result.updatedInput;
          if (updated === null || typeof updated !== 'object' || Array.isArray(updated)) {
            return { action: 'deny', reason: 'a PreToolUse hook returned a non-object updatedInput' };
          }
          return { action: 'rewrite', args: updated as Record<string, unknown> };
        }
        return undefined;
      };
      ctx.on(beforeToolCallEvent, onPreTool);

      /* PermissionRequest → permissionRequest (the gate's pre-answer) */
      const onPermissionRequest: Listener<[PermissionRequestContext], PermissionRequestVerdict | undefined> = async (reqCtx) => {
        const { result } = await dispatch({
          event: 'PermissionRequest',
          subject: reqCtx.toolName,
          tool: reqCtx.call,
          sessionId: reqCtx.sessionId,
        });
        const decision = result.permissionRequestResult;
        if (decision !== undefined) {
          return {
            decision: decision.behavior,
            ...(decision.message !== undefined ? { reason: decision.message } : {}),
            ...(decision.updatedInput !== undefined ? { updatedInput: decision.updatedInput } : {}),
          };
        }
        if (result.permissionBehavior !== undefined) {
          return {
            decision: result.permissionBehavior,
            ...(result.hookPermissionDecisionReason !== undefined
              ? { reason: result.hookPermissionDecisionReason }
              : {}),
          };
        }
        return undefined;
      };
      ctx.on(permissionRequestEvent, onPermissionRequest);

      /* PostToolUse → afterToolResult */
      const onPostTool: Listener<[ToolCall, string], string | undefined> = async (call, result) => {
        const { result: run } = await dispatch({
          event: 'PostToolUse',
          subject: call.name,
          tool: call,
          toolResult: result,
        });
        // ZCode keeps the tool result text ALONE and carries hook context as a
        // separate attachment. This kernel has no attachment channel yet, so the
        // context is appended as its own labelled block (never merged into the
        // result body's meaning) — see AGENTS.md for the pending attachment work.
        const text = joinContexts(run.additionalContexts);
        return text === undefined ? undefined : `${result}${SEP}<PostToolUse:${call.name} hook additional context>${SEP}${text}`;
      };
      ctx.on(afterToolResultEvent, onPostTool);

      /* PostToolUseFailure → postToolUseFailure */
      const onPostToolFailure: Listener<[ToolCall, string], string | undefined> = async (call, result) => {
        const { result: run } = await dispatch({
          event: 'PostToolUseFailure',
          subject: call.name,
          tool: call,
          toolResult: result,
        });
        const text = joinContexts(run.additionalContexts);
        return text === undefined
          ? undefined
          : `${result}${SEP}<PostToolUseFailure:${call.name} hook recovery context>${SEP}${text}`;
      };
      ctx.on(postToolUseFailureEvent, onPostToolFailure);

      /* Stop → beforeTurnEnd */
      const onStop: Listener<[BeforeTurnEndContext], BeforeTurnEndVerdict | undefined> = async () => {
        const sessionId = currentSession();
        const key = sessionId ?? '';
        const already = stopContinues.get(key) ?? 0;
        const { result } = await dispatch({
          event: 'Stop',
          ...(sessionId !== undefined ? { sessionId } : {}),
          stopHookActive: already > 0,
        });
        const wantsMore = result.stopShouldContinue === true || result.blockRequested === true;
        if (!wantsMore) return undefined;
        if (already >= STOP_CONTINUE_LIMIT) {
          // The cap is the point: a Stop hook that always blocks must not loop
          // the run forever. Reported so the operator can see why it stopped.
          options.onDiagnostic?.(`Stop hook asked to continue ${already} times; the cap is ${STOP_CONTINUE_LIMIT}`);
          return undefined;
        }
        stopContinues.set(key, already + 1);
        const reason = result.stopReason ?? joinContexts(result.additionalContexts) ?? 'A Stop hook asked to continue.';
        return { action: 'steer', message: { id: '', ts: Date.now(), role: 'user', content: reason } };
      };
      ctx.on(beforeTurnEndEvent, onStop);
    },
  };
}

/** Join contributors; undefined when nobody contributed (so callers keep the original). */
function joinContexts(contexts: readonly string[]): string | undefined {
  const filled = contexts.filter((text) => text.length > 0);
  return filled.length === 0 ? undefined : filled.join(SEP);
}

/** The reason text an exit-code-2 hook gave (stderr, then stdout, then a default). */
function blockReasonOf(outcome: HookRunOutcome): string {
  const fromStderr = outcome.stderr.trim();
  if (fromStderr.length > 0) return fromStderr;
  const fromStdout = outcome.stdout.trim();
  if (fromStdout.length > 0) return fromStdout;
  return 'Hook blocked execution';
}
