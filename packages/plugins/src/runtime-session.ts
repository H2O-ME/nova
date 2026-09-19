/**
 * Kernel wiring helpers (M11): the approval bridge + permission engine pair,
 * and the per-session open logic. Split from `runtime.ts` for the structure
 * budget; both read their collaborators through accessors so host rebuilds
 * and session switches never strand a captured reference.
 */
import {
  AgentSession,
  ApprovalBroker,
  CONTEXT_FRAGMENT_ID_PREFIX,
  newId,
  newSessionDir,
  recordSessionWorkspace,
  Session,
  toolOutputsDir,
  type AgentHooks,
  type AgentMessage,
  type ChatProvider,
  type JobRegistry,
  type ToolCall,
  type ToolCallView,
  type UserMessage,
} from '@nova-agent/core';
import { PermissionService, type ApprovalMode } from './permission.js';
import { PluginHost } from './host.js';
import type { KernelConfig } from './runtime-types.js';

/**
 * The approval wiring for one kernel: the broker renders asks from the LIVE
 * host (rebuilds re-point it), and the engine audits into the CURRENT
 * session's log — both through accessors, never captured references.
 */
export function makeApprovalWiring(p: {
  approval: ApprovalMode;
  host: () => PluginHost;
  rootDir: () => string;
  current: () => AgentSession | undefined;
}): { bridge: ApprovalBroker; permission: PermissionService } {
  const bridge = new ApprovalBroker(
    (call: ToolCall): ToolCallView | undefined =>
      p.host().tools.find((tool) => tool.name === call.name)?.presentCall?.(call.args),
    async (call: ToolCall): Promise<string[]> => {
      // Effect preview is best-effort (never blocks the ask): the tool's own
      // declaration decides what it will do (e.g. edit_file's diff).
      const entry = p.host().toolEntries.find((item) => item.tool.name === call.name);
      if (entry?.tool.preview === undefined) return [];
      try {
        const text = (await entry.tool.preview(call.args, { rootDir: p.rootDir() })).trim();
        return text.length > 0 ? text.split('\n') : [];
      } catch {
        return [];
      }
    },
  );
  const permission = new PermissionService(p.approval, bridge.asker, (entry) => {
    void p
      .current()
      ?.session.appendEvent({
        type: 'approval',
        toolName: entry.toolName,
        kind: entry.kind,
        outcome: entry.outcome,
        at: Date.now(),
      })
      .catch(() => undefined);
  });
  return { bridge, permission };
}

/**
 * One durable session over the kernel wiring: fresh (fragment-seeded,
 * workspace-marked) or resumed (projection-derived, no reseed). The returned
 * handle reads the LIVE host/hooks so rebuilds apply to its next run.
 */
export async function openAgentSession(
  p: {
    provider: ChatProvider;
    config: KernelConfig;
    systemPrompt: string;
    bridge: ApprovalBroker;
    permission: PermissionService;
    jobs: JobRegistry;
    rootDir: () => string;
    host: () => PluginHost;
    hooks: () => AgentHooks;
    buildFragment: () => string;
    perRequestCompact: boolean;
  },
  sessionOpts?: { resumeFile?: string; sessionDir?: string },
): Promise<AgentSession> {
  let session: Session;
  let messages: AgentMessage[];
  if (sessionOpts?.resumeFile !== undefined) {
    session = await Session.open(sessionOpts.resumeFile);
    messages = session.deriveMessages();
  } else {
    session = await Session.create(sessionOpts?.sessionDir ?? newSessionDir());
    await recordSessionWorkspace(session, p.rootDir());
    messages = [];
    // The dedicated id prefix (not a plain msg_ id) lets compaction exclude
    // the fragment by id — see CONTEXT_FRAGMENT_ID_PREFIX.
    const seed: UserMessage = {
      id: newId(CONTEXT_FRAGMENT_ID_PREFIX.slice(0, -1)),
      ts: Date.now(),
      role: 'user',
      content: p.buildFragment(),
    };
    messages.push(seed);
    await session.append(seed);
  }
  const agent = new AgentSession({
    session,
    messages,
    provider: p.provider,
    rootDir: p.rootDir,
    tools: () => p.host().tools,
    hooks: p.hooks,
    jobs: p.jobs,
    approvals: p.bridge,
    permission: p.permission,
    systemPrompt: p.systemPrompt,
    maxTurns: p.config.maxTurns,
    cacheDir: () => toolOutputsDir(session.id),
    ...(p.config.autoCompactTokenLimit !== undefined
      ? { autoCompactLimit: p.config.autoCompactTokenLimit }
      : {}),
    ...(p.perRequestCompact ? { perRequestCompact: true } : {}),
  });
  return agent;
}
