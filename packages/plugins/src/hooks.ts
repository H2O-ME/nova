/**
 * Hook composition, on top of the container's typed events.
 *
 * The three lifecycle points are ordinary container events now
 * (`beforeLlmCall` / `beforeToolCall` / `afterToolResult`), so a plugin hooks
 * in with the same `ctx.on(...)` it uses for anything else, and unloading takes
 * the hook back automatically. What remains here is the *composition*: turning
 * the event chains into the single `AgentHooks` object the loop consumes, plus
 * the tool-set guard that must survive any chain.
 *
 *  - `beforeLLMCall` is a waterfall: a hook that wraps the request calls
 *    `next()`, one that merely transforms it calls `next(rewritten)`.
 *  - `beforeToolCall` is serial and first-decisive-wins, with the approval
 *    gate registered at high priority (see `permissionGatePlugin`) so
 *    permission is settled before any other hook sees the call.
 *  - `afterToolResult` is a waterfall over the result text.
 */
import {
  afterToolResult as afterToolResultEvent,
  approval as approvalKey,
  beforeLlmCall as beforeLlmCallEvent,
  beforeToolCall as beforeToolCallEvent,
  beforeTurnEnd as beforeTurnEndEvent,
  tools as toolsKey,
  type AgentHooks,
  type BeforeTurnEndContext,
  type BeforeTurnEndVerdict,
  type ChatRequest,
  type Context,
  type Listener,
  type Plugin,
  type ToolCall,
  type ToolCallVerdict,
  validateToolCallVerdict,
} from '@nova-agent/core';

/**
 * One composed chain object per container root, cached.
 *
 * The identity matters: a wrapper (the headless auto-compact gate) replaces one
 * of these methods to gate every request, and the loop re-reads its hooks every
 * run. Handing back a fresh object each call would silently drop such a
 * wrapper — exactly the bug that made exec's auto-compact stop firing. The
 * methods still read the LIVE event chains, so caching the object costs nothing
 * in freshness.
 */
const composed = new WeakMap<Context, AgentHooks>();

export function composeHooks(ctx: Context): AgentHooks {
  const cached = composed.get(ctx);
  if (cached !== undefined) return cached;
  const hooks = buildHooks(ctx);
  composed.set(ctx, hooks);
  return hooks;
}

function buildHooks(ctx: Context): AgentHooks {
  return {
    beforeLLMCall: async (req: ChatRequest): Promise<ChatRequest> => {
      const before = req.tools === undefined ? undefined : new Set(req.tools.map((tool) => tool.name));
      const out = (await ctx.waterfall(beforeLlmCallEvent, req)) ?? req;
      assertToolSetUnchanged(before, out);
      return out;
    },
    beforeToolCall: async (call: ToolCall): Promise<ToolCallVerdict> => {
      const verdict = await ctx.serial(beforeToolCallEvent, call);
      if (verdict === undefined) return { action: 'allow' };
      const malformed = validateToolCallVerdict(verdict);
      if (malformed !== undefined) {
        return { action: 'deny', reason: `malformed hook verdict (${malformed})` };
      }
      return verdict;
    },
    afterToolResult: async (call: ToolCall, result: string): Promise<string> => {
      return (await ctx.waterfall(afterToolResultEvent, call, result)) ?? result;
    },
    beforeTurnEnd: async (turnCtx: BeforeTurnEndContext): Promise<BeforeTurnEndVerdict | void> => {
      // Serial / first-decisive-wins, mirroring beforeToolCall. The first
      // plugin that returns `{ action: 'steer' }` (or `{ action: 'stop' }`)
      // wins; `undefined` passes to the next listener.
      const verdict = await ctx.serial(beforeTurnEndEvent, turnCtx);
      if (verdict === undefined || verdict === null) return;
      return verdict;
    },
  };
}

/**
 * The approval gate as a plugin: it inserts itself into the `tool/before`
 * chain at the highest priority, so permission is settled before any other
 * hook runs — and a later hook can still veto or rewrite. It reads the registry
 * and the gate from the container (both declared in `inject`), so replacing
 * either one re-points the gate instead of stranding it on a captured handle.
 */
export const permissionGatePlugin: Plugin = {
  name: 'approval-gate',
  inject: [toolsKey, approvalKey],
  apply: (ctx: Context): void => {
    const registry = ctx.must(toolsKey);
    const gate = ctx.must(approvalKey);
    const listener: Listener<[ToolCall], ToolCallVerdict | undefined> = async (call) => {
      const kind = await registry.permissionFor(call.name, call.args);
      if (kind === undefined) return undefined;
      const decision = await gate.decideDetailed(call.name, kind, call);
      if (decision === 'allow') return undefined;
      return {
        action: 'deny',
        reason: decision.reason !== undefined ? `by user: ${decision.reason}` : 'by user',
      };
    };
    ctx.on(beforeToolCallEvent, listener, { priority: 1000 });
  },
};

/**
 * Prefix-cache and reach guard: the tool array's wire order is dictionary
 * sorted and part of the cached prefix, and the set itself is what the model
 * may call. A hook may narrow it (the PTC projection does) or hand back a
 * clone, never add — an addition has no approval record and silently widens
 * the model's reach. Compared by NAME SET, not array identity, because
 * legitimate plumbing clones the array.
 */
function assertToolSetUnchanged(before: Set<string> | undefined, req: ChatRequest): void {
  if (before === undefined || req.tools === undefined) return;
  const added = req.tools.filter((tool) => !before.has(tool.name));
  if (added.length > 0) {
    throw new Error(
      `beforeLLMCall hook added tools without approval: ${added.map((tool) => tool.name).join(', ')}`,
    );
  }
}