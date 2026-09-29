/**
 * The shipped providers for the kernel-level capability seams.
 *
 * Each one is a plugin that provides exactly one service, so an operator can
 * replace a capability by loading another provider of the same key (or drop it
 * by leaving it out of the roster) without touching the kernel. The bodies are
 * thin on purpose: they adapt an existing implementation to the seam and read
 * their collaborators from the container, so a rebuild re-points them instead
 * of stranding them on a captured handle.
 */
import {
  approval as approvalKey,
  compactSession,
  compaction as compactionKey,
  jobs as jobsKey,
  llm as llmKey,
  sessions as sessionsKey,
  skills as skillsKey,
  spill as spillKey,
  surfaces as surfacesKey,
  toolOutputsDir,
  userQuestions as userQuestionsKey,
  type AgentSession,
  type ApprovalService,
  type AskQuestionsFn,
  type ChatProvider,
  type CompactedSession,
  type CompactSessionOptions,
  type Context,
  type JobRegistry,
  type Plugin,
  type SkillInfo,
  type SurfaceRegistry,
} from '@nova-agent/core';
import type { SkillMetadata } from './skills.js';

/**
 * The model end. `bindSession` is what keeps the provider cache-affinity header
 * in sync: the session plumbing calls it when a session becomes current, so
 * affinity is a property of the service rather than something each surface has
 * to remember to wire.
 *
 * `model` reads through to the LIVE provider (`ChatProvider.model`) and only
 * falls back to the assembly-time id — a provider that can retarget
 * (`setModel`) makes the id move without this service being rebuilt, which is
 * exactly what a picker needs. Affinity is unaffected by a switch: the client
 * instance never changes, so the bound session id stays bound.
 */
export function llmProvider(p: {
  provider: ChatProvider;
  /** Fallback model id for clients that do not report one (test providers). */
  model: string;
  providerName?: string;
}): Plugin {
  const affinity = p.provider as { setSessionId?: (id: string | undefined) => void };
  return {
    name: p.providerName ?? 'llm',
    apply: (ctx: Context): void => {
      ctx.provide(llmKey, {
        provider: p.provider,
        get model(): string {
          return p.provider.model ?? p.model;
        },
        bindSession: (sessionId) => affinity.setSessionId?.(sessionId),
      });
    },
  };
}

/**
 * Background work: the same registry instance the whole kernel shares.
 *
 * The fiber is named `jobs-service`, NOT `jobs`: the model-facing `jobs` tool
 * plugin (`builtin/jobs.ts`) already owns that name, and two fibers sharing it
 * made "core names are load-bearing" lock the tool's switch as well — clicking
 * it threw instead of turning the tool off. The service KEY is unchanged
 * (`jobs as jobsKey`), so every `ctx.get(jobsKey)` reader is unaffected; only
 * the diagnostics/manifest name differs.
 */
export function jobsProvider(registry: JobRegistry): Plugin {
  return {
    name: 'jobs-service',
    apply: (ctx: Context): void => {
      ctx.provide(jobsKey, registry);
    },
  };
}

/** Oversized tool output lands in the session's spill directory, never the workspace. */
export function spillProvider(): Plugin {
  return {
    name: 'spill',
    apply: (ctx: Context): void => {
      ctx.provide(spillKey, { dir: (sessionId) => toolOutputsDir(sessionId) });
    },
  };
}

/** The compaction strategy — replaceable as a unit (that is where the tokens are). */
export function compactionProvider(run?: (options: CompactSessionOptions) => Promise<CompactedSession>): Plugin {
  return {
    name: 'compaction',
    apply: (ctx: Context): void => {
      ctx.provide(compactionKey, { run: run ?? compactSession });
    },
  };
}

/**
 * The approval gate. The service instance is passed in, not built here: its
 * remembered "always" grants must survive host rebuilds, so the kernel owns the
 * instance and the plugin only publishes it under its key.
 */
export function approvalProvider(service: ApprovalService): Plugin {
  return {
    name: 'approval',
    apply: (ctx: Context): void => {
      ctx.provide(approvalKey, service);
    },
  };
}

/**
 * Session lifecycle. `open` is the kernel's own session factory (it needs the
 * provider, the config and the fragment builder — all kernel business); this
 * provider owns only "which session is current", which is what a `/new`, a
 * resumed file and a bot peer switch all have to agree on.
 */
export function sessionsProvider(open: (options?: { resumeFile?: string; sessionDir?: string }) => Promise<AgentSession>): Plugin {
  let current: AgentSession | undefined;
  return {
    name: 'sessions',
    // The affinity binding lives here because *this* is what knows which
    // session is current: a peer switch (`activate`) has to re-bind exactly
    // like an open does, or the cache-routing header keeps pointing at the
    // previous conversation. That was a real bug when each surface bound it
    // by hand.
    inject: [llmKey],
    apply: (ctx: Context): void => {
      const bind = (session: AgentSession): AgentSession => {
        ctx.get(llmKey)?.bindSession(session.session.id);
        return session;
      };
      ctx.provide(sessionsKey, {
        current: () => current,
        open: async (options) => {
          current = bind(await open(options));
          return current;
        },
        activate: (session: AgentSession) => {
          current = bind(session);
        },
      });
    },
  };
}

/**
 * The skill index. Only the index is published — name, description and where
 * the skill came from — because that is all a surface shows: the body is
 * loaded on demand through the `skill` tool, which is what keeps skills
 * progressive rather than a boot-time dump.
 */
export function skillsProvider(
  source: () => readonly SkillMetadata[],
  reload: () => Promise<readonly SkillMetadata[]>,
): Plugin {
  return {
    name: 'skills',
    apply: (ctx: Context): void => {
      ctx.provide(skillsKey, {
        all: () => source().map(toInfo),
        reload: async () => (await reload()).map(toInfo),
      });
    },
  };
}

function toInfo(skill: SkillMetadata): SkillInfo {
  return { name: skill.name, description: skill.description, source: skill.level };
}

/**
 * "Can this surface ask a human?" — the answerer seam the `ask_user_question`
 * tool reads at call time. Mirrors dsh's root-level `user-questions` row: the
 * service is what the tool depends on, so the tool is no longer handed an
 * answerer (or nothing) as an assembly option, and the per-assembly-site
 * booleans are gone.
 *
 * `answers` is a thunk, not a boolean, because the answer must be read PER CALL:
 * a surface that only becomes known once it claims the invocation (the registry
 * is resolved after the kernel exists) must still be able to say yes. Reading it
 * eagerly at assembly time is exactly the bug that made the TUI's first restore
 * silently never ask.
 */
export function userQuestionsProvider(asker: AskQuestionsFn, answers: () => boolean): Plugin {
  return {
    name: 'user-questions',
    apply: (ctx: Context): void => {
      ctx.provide(userQuestionsKey, { answerer: () => (answers() ? asker : undefined) });
    },
  };
}

/**
 * The surface registry as a container service. The INSTANCE is built by the
 * caller (it must exist before the kernel so the roster can load surface
 * plugins into the same registry the resolver reads), but providing it here is
 * what makes a surface an ordinary plugin row instead of something living
 * outside the container: `/plugins` lists it, and its provider is replaceable
 * by key like every other capability.
 */
export function surfaceRegistryProvider(registry: SurfaceRegistry): Plugin {
  return {
    name: 'surfaces',
    apply: (ctx: Context): void => {
      ctx.provide(surfacesKey, registry);
    },
  };
}