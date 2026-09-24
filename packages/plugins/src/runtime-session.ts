/**
 * The per-session open logic and the approval wiring.
 *
 * Both read their collaborators through accessors into the container, so a
 * workspace switch (which re-rosters the tool registry) or a session switch
 * never strands a captured reference: an ask rendered after a rebuild still
 * shows the CURRENT tool's preview and diff.
 */
import {
  AgentSession,
  ApprovalBroker,
  CONTEXT_FRAGMENT_ID_PREFIX,
  newId,
  newSessionDir,
  recordSessionWorkspace,
  Session,
  type AgentHooks,
  type AgentMessage,
  type ChatProvider,
  type CompactedSession,
  type CompactSessionOptions,
  type JobRegistry,
  type ToolCall,
  type ToolCallView,
  type ToolRegistry,
  type UserMessage,
} from '@nova-agent/core';
import { PermissionService, type ApprovalMode } from './permission.js';
import type { KernelConfig } from './runtime-types.js';

export type { PermissionService };

/**
 * The approval wiring for one kernel: the broker renders asks from the LIVE
 * registry (re-rostering re-points it) and the engine audits into the CURRENT
 * session's log — both through accessors, never captured references.
 */
export function makeApprovalWiring(p: {
  approval: ApprovalMode;
  rootDir: () => string;
  tools: () => ToolRegistry | undefined;
  current: () => AgentSession | undefined;
}): { bridge: ApprovalBroker; permission: PermissionService } {
  const bridge = new ApprovalBroker(
    (call: ToolCall): ToolCallView | undefined => p.tools()?.find(call.name)?.presentCall?.(call.args),
    async (call: ToolCall): Promise<string[]> => {
      // Effect preview is best-effort (never blocks the ask): the tool's own
      // declaration decides what it will do (e.g. edit_file's diff).
      const entry = p.tools()
        ?.entries()
        .find((item) => item.tool.name === call.name);
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

/** Everything one session handle reads from the kernel, as live accessors. */
export interface OpenSessionDeps {
  config: KernelConfig;
  systemPrompt: string;
  provider: ChatProvider;
  bridge: ApprovalBroker;
  permission: PermissionService;
  rootDir: () => string;
  tools: () => readonly import('@nova-agent/core').ToolDefinition[];
  hooks: () => AgentHooks;
  jobs: JobRegistry;
  buildFragment: () => string;
  /** Spill directory for this session's oversized tool output. */
  cacheDir: (sessionId: string) => string;
  /** The compaction strategy (the `compaction` service). */
  compact: (options: CompactSessionOptions) => Promise<CompactedSession>;
  perRequestCompact: boolean;
}

/**
 * One durable session over the kernel wiring: fresh (fragment-seeded,
 * workspace-marked) or resumed (projection-derived, no reseed). The handle
 * reads the LIVE hooks, tools and spill dir, so a rebuild applies to its next
 * run.
 */
export async function openAgentSession(
  p: OpenSessionDeps,
  sessionOpts?: { resumeFile?: string; sessionDir?: string },
): Promise<AgentSession> {
  const { session, messages } = await openLog(p, sessionOpts);
  return new AgentSession({
    session,
    messages,
    provider: p.provider,
    rootDir: p.rootDir,
    tools: () => [...p.tools()],
    hooks: p.hooks,
    jobs: p.jobs,
    approvals: p.bridge,
    permission: p.permission,
    systemPrompt: p.systemPrompt,
    maxTurns: p.config.maxTurns,
    cacheDir: () => p.cacheDir(session.id),
    compact: p.compact,
    ...(p.config.autoCompactTokenLimit !== undefined
      ? { autoCompactLimit: p.config.autoCompactTokenLimit }
      : {}),
    ...(p.perRequestCompact ? { perRequestCompact: true } : {}),
  });
}

/** Fresh (seeded with the context fragment) or resumed (projection-derived). */
async function openLog(
  p: OpenSessionDeps,
  sessionOpts?: { resumeFile?: string; sessionDir?: string },
): Promise<{ session: Session; messages: AgentMessage[] }> {
  if (sessionOpts?.resumeFile !== undefined) {
    const session = await Session.open(sessionOpts.resumeFile);
    return { session, messages: session.deriveMessages() };
  }
  const session = await Session.create(sessionOpts?.sessionDir ?? newSessionDir());
  await recordSessionWorkspace(session, p.rootDir());
  // The dedicated id prefix (not a plain msg_ id) is what lets compaction
  // exclude the fragment by id — see CONTEXT_FRAGMENT_ID_PREFIX.
  const seed: UserMessage = {
    id: newId(CONTEXT_FRAGMENT_ID_PREFIX.slice(0, -1)),
    ts: Date.now(),
    role: 'user',
    content: p.buildFragment(),
  };
  await session.append(seed);
  return { session, messages: [seed] };
}