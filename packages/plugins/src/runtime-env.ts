/**
 * The assembly environment: the container, the mutable parts a workspace or
 * mode change re-points, and the closures every other assembly file reads.
 *
 * Split from `runtime.ts` so the factory body stays readable and the shared
 * shape (what the roster and the façade are allowed to touch) is declared in
 * exactly one place. Everything here is created once per kernel.
 */
import path from 'node:path';
import {
  agentsSkillsRoot,
  buildContextFragment,
  compaction as compactionKey,
  Context,
  jobs as jobsKey,
  llm as llmKey,
  JobRegistry,
  localDateKey,
  NOVA_DIR,
  novaHome,
  deriveUserQuestions,
  sessions as sessionsKey,
  spill as spillKey,
  tools as toolsKey,
  type AgentHooks,
  type AgentSession,
  type ApprovalBroker,
  type ChatProvider,
  type CompactedSession,
  type CompactSessionOptions,
  type PtcMode,
  type QuestionBroker,
  type SessionEnvInfo,
} from '@nova-agent/core';
import { collectProjectDocs } from './agents-md.js';
import { resolveShellName } from './builtin/bash.js';
import { PluginHost } from './host.js';
import { composeHooks } from './hooks.js';
import { buildSystemPrompt } from './system-prompt.js';
import { loadSkills, type SkillMetadata, type SkillRoot } from './skills.js';
import type { CreateKernelOptions, PluginDescriptor, PluginRosterEntry } from './runtime-types.js';
import { jobListener } from './job-listener.js';
import { makeApprovalWiring, makeQuestionBridge, openAgentSession, type PermissionService } from './runtime-session.js';
import {
  approvalProvider,
  compactionProvider,
  jobsProvider,
  llmProvider,
  sessionsProvider,
  skillsProvider,
  spillProvider,
  surfaceRegistryProvider,
  userQuestionsProvider,
} from './services.js';

/** What the assembly mutates: the parts a workspace/mode change re-points. */
export interface State {
  rootDir: string;
  codeMode: PtcMode;
  projectDocs: string[];
  /**
   * The skills in force: discovery MINUS `skillsDisable`. This is what the
   * `<available_skills>` fragment and the `skill` tool are built from, so one
   * list governs both doors.
   */
  skills: SkillMetadata[];
  /**
   * Every DISCOVERED skill, switched-off ones included. The Skill 中心 reads
   * this, never `skills`: a disabled skill must stay on the page that turns it
   * back on, and it is absent from `skills` by definition — reading the filtered
   * list there would make the switch one-way (the row would vanish on the flip
   * that disabled it, with no way to undo).
   */
  allSkills: SkillMetadata[];
  host: PluginHost | undefined;
  /**
   * Skills the Skill 中心 turned off (config `skills.disable`, by name, both
   * levels). Mutable: the settings panel flips it through `setSkillEnabled`,
   * and `loadWorkspace` re-reads it after every switch.
   */
  skillsDisable: string[];
  /**
   * Plugins the plugin manager turned off (`plugins.disable`). Mutable for the
   * same reason; `reroster` reads it instead of the boot-time config, so a
   * mid-process flip survives the NEXT workspace switch too.
   */
  pluginsDisable: string[];
  /**
   * Plugins the manager has turned ON against their tier default
   * (`plugins.enable`) — the `advanced` half of the two-list split. Mutable and
   * read by `reroster` for the same reason as `pluginsDisable`: a switch made
   * mid-process must survive the next workspace switch. The two lists are
   * disjoint: a flip writes ONE of them, chosen by tier (`runtime-switch.ts`).
   */
  pluginsEnable: string[];
  /**
   * Every known plugin's name + origin + description. Loaded plugins report
   * live from the container; disabled ones leave no fiber, so their rows come
   * from this manifest — otherwise a turned-off plugin would vanish from the
   * very page that turns it back on. Refreshed on every roster.
   */
  manifest: PluginDescriptor[];
}

/** The assembled pieces every other assembly file reaches for. */
export interface Environment {
  root: Context;
  state: State;
  jobs: JobRegistry;
  provider: ChatProvider;
  bridge: ApprovalBroker;
  /**
   * The question seam. It lives on the env rather than per session because the ask
   * tool is registered once per roster and must point at the kernel's ONE broker —
   * a per-session broker would be answered by a surface holding the wrong handle.
   */
  questions: QuestionBroker;
  permission: PermissionService;
  systemPrompt: string;
  sessionEnv(): SessionEnvInfo;
  buildFragment(): string;
  hooks(): AgentHooks;
  /** Re-scan docs + skills for the current workspace root. */
  loadWorkspace(): Promise<SkillMetadata[]>;
  /** The session FACTORY (what the `sessions` provider calls). */
  openSession(sessionOpts?: { resumeFile?: string; sessionDir?: string }): Promise<AgentSession>;
  /** Open through the service, which is what makes it the current session. */
  openCurrent(sessionOpts?: { resumeFile?: string; sessionDir?: string }): Promise<AgentSession>;
  /** Rebuild the tool host + roster for the current workspace/mode. */
  reroster(): Promise<void>;
  /**
   * Every known plugin's row, loaded or not: live rows from the container plus
   * manifest rows for the disabled ones (which leave no fiber).
   */
  describePlugins(): PluginRosterEntry[];
  /** Flip one plugin's switch: persist the disable list, then re-roster. */
  setPluginEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
  /** Flip one skill's switch: persist the disable list, then reload the index. */
  setSkillEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
}

/** Build the container, publish the capability providers, wire the closures. */
export function createEnvironment(opts: CreateKernelOptions): Environment {
  const { provider, config } = opts;
  const root = Context.createRoot();
  const jobs = new JobRegistry();
  const systemPrompt = opts.systemPrompt ?? buildSystemPrompt();
  const shellPath = typeof config.bash === 'object' ? config.bash.shellPath : undefined;
  const state: State = {
    rootDir: opts.rootDir,
    codeMode: config.code?.mode ?? 'native',
    projectDocs: [],
    skills: [],
    allSkills: [],
    host: undefined,
    skillsDisable: [...(config.skillsDisable ?? [])],
    pluginsDisable: [...(config.plugins?.disable ?? [])],
    pluginsEnable: [...(config.plugins?.enable ?? [])],
    manifest: [],
  };

  const { bridge, permission } = makeApprovalWiring({
    approval: config.approval,
    rootDir: () => state.rootDir,
    tools: () => root.get(toolsKey),
    current: () => root.get(sessionsKey)?.current(),
  });
  const questions = makeQuestionBridge();

  const env: Environment = {
    root,
    state,
    jobs,
    provider,
    bridge,
    questions,
    permission,
    systemPrompt,
    sessionEnv: () => ({
      platform: process.platform,
      cwd: state.rootDir,
      shell: resolveShellName(shellPath),
      // Local date, matching the session bucket: a UTC slice calls every
      // evening run west of the meridian "yesterday".
      today: localDateKey().join('-'),
    }),
    buildFragment: () =>
      buildContextFragment(env.sessionEnv(), config.userInstructions, state.skills, state.projectDocs),
    hooks: () => composeHooks(root),
    loadWorkspace: () => loadWorkspace(env, config.projectDocMaxTokens),
    openSession: (sessionOpts) => openSession(env, opts, sessionOpts),
    openCurrent: (sessionOpts) => root.must(sessionsKey).open(sessionOpts),
    reroster: () => reroster(env, opts),
    describePlugins: () => describePlugins(env),
    setPluginEnabled: (name, enabled) => setPluginEnabled(env, opts, name, enabled),
    setSkillEnabled: (name, enabled) => setSkillEnabled(env, opts, name, enabled),
  };

  // ── capability providers: one plugin per seam, replaceable by key ────────
  root.plugin(approvalProvider(permission), {}, 'approval');
  root.plugin(llmProvider({ provider, model: opts.model ?? '' }), {}, 'llm');
  // `jobs-service`, not `jobs`: the model-facing `jobs` TOOL plugin owns that
  // name, and a shared name made the tool's switch unsheddable (see
  // `jobsProvider`). The service key is still `jobs`.
  root.plugin(jobsProvider(jobs), {}, "jobs-service");
  root.plugin(spillProvider(), {}, 'spill');
  root.plugin(compactionProvider(), {}, 'compaction');
  root.plugin(skillsProvider(() => state.skills, () => loadWorkspace(env, config.projectDocMaxTokens)), {}, 'skills');
  root.plugin(sessionsProvider(env.openSession), {}, 'sessions');
  // The surface registry, provided INTO the container. The instance is built by
  // the caller (see `surfaceRegistryProvider`): it has to exist before the
  // kernel so the roster loads surface plugins into the registry the resolver
  // will read. Providing it is what makes a surface an ordinary row.
  if (opts.surfaces !== undefined) {
    root.plugin(surfaceRegistryProvider(opts.surfaces.registry), {}, 'surfaces');
  }
  // The answerer seam the ask tool reads per call. This is the ONE source now:
  // "does the surface in force have a human?" is answered from the registry,
  // lazily, so no assembly site hand-copies a boolean and no surface with a
  // human can be forgotten again. A registry that has not resolved yet (or a
  // surface with no human) answers false → the tool reports NO_PROVIDER instead
  // of parking a run no card can release.
  //
  // The legacy `opts.userQuestions` boolean is still honoured for assemblies
  // that supply neither a registry nor a surface plugin (kernel tests, embedders
  // that wire the ask tool by hand). It is ORed, never required.
  root.plugin(
    userQuestionsProvider(questions.asker, () => {
      const current = opts.surfaces?.registry.current();
      if (current !== undefined) return deriveUserQuestions(current);
      return opts.userQuestions === true;
    }),
    {},
    'user-questions',
  );
  return env;
}

/** Open one durable session handle over the live services. */
async function openSession(
  env: Environment,
  opts: CreateKernelOptions,
  sessionOpts?: { resumeFile?: string; sessionDir?: string },
): Promise<AgentSession> {
  const llm = env.root.must(llmKey);
  const jobs = env.root.must(jobsKey);
  const agent = await openAgentSession(
    {
      config: opts.config,
      systemPrompt: env.systemPrompt,
      bridge: env.bridge,
      questions: env.questions,
      permission: env.permission,
      provider: llm.provider,
      rootDir: () => env.state.rootDir,
      tools: () => [...env.root.must(toolsKey).all()],
      hooks: env.hooks,
      jobs,
      buildFragment: env.buildFragment,
      cacheDir: (sessionId) => env.root.must(spillKey).dir(sessionId),
      compact: (options: CompactSessionOptions): Promise<CompactedSession> =>
        env.root.must(compactionKey).run(options),
      perRequestCompact: opts.perRequestCompact === true,
      // Input modalities of the model in force, read per request. The provider
      // is the authority on WHICH model is active (`ChatProvider.model`) and the
      // catalog answers what that id can accept, so this reads both live rather
      // than capturing either: the user can switch models between turns, and an
      // image attached under a vision model must become a text placeholder the
      // moment the model in force cannot accept it.
      inputModalities: async () => {
        const catalog = opts.modelCatalog;
        const model = llm.provider.model;
        if (catalog?.capabilities === undefined || model === undefined) return undefined;
        try {
          return (await catalog.capabilities(model))?.inputModalities;
        } catch {
          // A catalog that cannot answer must not fail the turn: `undefined`
          // means "not declared", which fails OPEN (see `acceptsImages`).
          return undefined;
        }
      },
    },
    sessionOpts,
  );
  // Affinity is bound by the sessions provider (open AND activate), so this
  // factory only has to hand back a live handle.
  jobs.setListener(jobListener(env));
  return agent;
}

/** Project + user skills and the AGENTS.md chain for the current root. */
async function loadWorkspace(env: Environment, maxDocTokens?: number): Promise<SkillMetadata[]> {
  const dir = env.state.rootDir;
  // The chain's working directory is the workspace root itself, never
  // `process.cwd()`: the docs a session injects must follow its workspace, not
  // where the process was launched (a resumed session can root anywhere).
  env.state.projectDocs = await collectProjectDocs(dir, dir, ...(maxDocTokens !== undefined ? [maxDocTokens] : []));
  const all = await loadSkills(skillRoots(dir));
  // The Skill 中心's switch subtracts by NAME here — the one filter the whole
  // product reads: the `<available_skills>` block (built from `state.skills`
  // via `buildFragment`) and the `skill` tool (registered over the same list)
  // both see the filtered list, so one rule governs both doors. The UNFILTERED
  // discovery is kept alongside it so the panel can still list — and therefore
  // re-enable — a skill this filter removed. A name matching nothing warns at
  // assembly (the `plugins.disable` typo discipline), not here: this runs on
  // every workspace switch, where warning every time would spam.
  const off = new Set(env.state.skillsDisable);
  env.state.allSkills = all;
  env.state.skills = all.filter((skill) => !off.has(skill.name));
  return env.state.skills;
}

/**
 * The skill roots for `rootDir`, in precedence order — first listing of a name
 * wins.
 *
 * The cross-tool `.agents` standard comes FIRST at each level, because that is
 * where other agents and the operator's shared tooling install skills; nova's
 * own `.nova/skills` stays as the second root per level so an existing install
 * keeps working. `level` only drives the Skill 中心's project/system grouping,
 * so both roots at a level carry that level's value.
 * @param rootDir - the workspace root.
 * @returns the ordered roots to walk.
 */
function skillRoots(rootDir: string): SkillRoot[] {
  return [
    { dir: agentsSkillsRoot(rootDir), level: 'project' },
    { dir: path.join(rootDir, NOVA_DIR, 'skills'), level: 'project' },
    { dir: agentsSkillsRoot(), level: 'user' },
    { dir: path.join(novaHome(), 'skills'), level: 'user' },
  ];
}

/**
 * The roster module reads the environment TYPE from here; this file reads its
 * `reroster` value — a one-way runtime edge with a type-only import back, so
 * there is no evaluation cycle.
 */
import { describePlugins, setPluginEnabled, setSkillEnabled } from './runtime-switch.js';
import { reroster } from './runtime-roster.js';
