/**
 * The surface host: the ONE assembly every surface goes through — built-in or
 * configured — and the adapter that hands an `AgentSurface` its runtime.
 *
 * 内置四家与动态 surface 在这里合流：`buildSurfaceRuntime` 装一次内核
 * （provider → `bootKernel` → workspace holder → boot 贡献的选项 → `afterBoot`），
 * 再把 `AgentSurfaceRuntime`（kernel + 命令口 + 模型读数 + 主题）交给
 * `surface.start`。`cli/kernel-boot.ts` 的 `bootKernel` 是这里唯一的装配函数，
 * 而 `createAgentKernel` 只被 `bootKernel` 调用——「谁装内核」全仓一处，
 * 「新选项被静默丢掉」不再有地方可漏。
 */
import os from 'node:os';
import { deriveUserQuestions } from '@nova-agent/core';
import type {
  AgentSurface,
  AgentSurfaceCommandResult,
  AgentSurfaceDiagnostic,
  AgentSurfaceFlags,
  AgentSurfaceRequest,
  AgentSurfaceRuntime,
  AgentSurfaceUi,
  ChatProvider,
  ModelCatalogPort,
  Plugin,
  SurfaceRows,
} from '@nova-agent/core';
import type { CreateKernelOptions, Kernel } from '@nova-agent/plugins';
import type { ParsedArgs } from './cli-args.js';
import { runAgentCommand } from './command-runner.js';
import { mergedCommandSpecs, createModelListCache } from './commands.js';
import type { Config, ConfigDiagnostic } from './config.js';
import { bootKernel, createProvider } from './kernel-boot.js';
import { createModelMetaStore } from './model-meta.js';

/** The resolved invocation the shell assembles for: everything but "who claims it". */
export interface SurfaceRequest {
  rootDir: string;
  config: Config;
  parsed: ParsedArgs;
  diagnostics: readonly ConfigDiagnostic[];
  /** Both stdio ends are a TTY — the same reading the claim request carries. */
  interactive: boolean;
  /**
   * Configured surfaces this invocation was resolved against (loaded by
   * `loadDynamicSurfaces`). Always supplied by the shell: the registry's
   * recorded winner is what the `userQuestions` provider reads, so the rows can
   * never be "absent because no surface was configured".
   */
  surfaces?: SurfaceRows;
}

/**
 * What a BUILT-IN surface contributes to the one assembly, beyond the shared
 * options: extra kernel options (`exec`'s per-request compaction, `qqbot`'s
 * channel plugin + session bucket, web's model catalog + config writers) and
 * post-assembly adjustments (unattended policy).
 *
 * Configured surfaces contribute nothing: their runtime is the shared one, and
 * the contract stays free of cli-side boot knobs. Deliberately an explicit
 * shape rather than `Partial<CreateKernelOptions>` — a surface must not be able
 * to silently set `userQuestions` or `rootDir` behind the shell's back.
 */
export interface SurfaceBoot {
  /** Kernel options contributed by the winning built-in (async: web resolves metadata). */
  kernel?: () => Promise<SurfaceKernelContribution> | SurfaceKernelContribution;
  /** Post-assembly adjustments on the assembled kernel (`setPolicy('never')`, …). */
  afterBoot?: (kernel: Kernel) => void;
}

/** The kernel options a built-in may contribute (a reviewed subset). */
export interface SurfaceKernelContribution {
  provider?: ChatProvider;
  extraPlugins?: readonly Plugin[];
  sessionDir?: string;
  perRequestCompact?: boolean;
  modelCatalog?: ModelCatalogPort;
  persistConfig?: CreateKernelOptions['persistConfig'];
}

/** A built-in surface plus the shell-side facts only the shell knows about it. */
export interface BuiltinSurface {
  surface: AgentSurface;
  boot?: SurfaceBoot;
}

/** Resolve an `AgentSurface` invocation: assemble the kernel, then run the surface. */
export async function runSurface(
  surface: AgentSurface,
  m: SurfaceRequest,
  argv: readonly string[],
  boot?: SurfaceBoot,
): Promise<void> {
  const runtime = await buildSurfaceRuntime(surface, m, argv, boot);
  // The surface owns its teardown (`app.stop()` before kernel/jobs dispose); the
  // host stops here once `start` resolves.
  await surface.start(runtime);
}

export async function buildSurfaceRuntime(
  surface: AgentSurface,
  m: SurfaceRequest,
  argv: readonly string[],
  boot?: SurfaceBoot,
): Promise<AgentSurfaceRuntime> {
  const bootContribution = boot?.kernel;
  const contributed = bootContribution === undefined ? {} : await bootContribution();
  const client = contributed.provider ?? (await createProvider(m.config));
  // `workspace.onChange` is bound before the kernel exists, so the holder is
  // what makes that honest; the surface in force gets the feedback callback the
  // contract advertises (`onWorkspaceChanged` — previously a declared-but-dead
  // member no one implemented or wired).
  const holder: { kernel?: Kernel } = {};
  const kernel = await bootKernel({
    rootDir: m.rootDir,
    config: m.config,
    provider: client,
    ...(m.parsed.approvalOverride !== undefined ? { approvalOverride: m.parsed.approvalOverride } : {}),
    ...(m.parsed.resumeFile !== undefined ? { resumeFile: m.parsed.resumeFile } : {}),
    ...(contributed.perRequestCompact !== undefined ? { perRequestCompact: contributed.perRequestCompact } : {}),
    ...(contributed.sessionDir !== undefined ? { sessionDir: contributed.sessionDir } : {}),
    ...(contributed.extraPlugins !== undefined ? { extraPlugins: [...contributed.extraPlugins] } : {}),
    ...(contributed.modelCatalog !== undefined ? { modelCatalog: contributed.modelCatalog } : {}),
    ...(contributed.persistConfig !== undefined ? { persistConfig: contributed.persistConfig } : {}),
    ...(m.surfaces !== undefined ? { surfaces: m.surfaces } : {}),
    // Fail-closed by default; the registry's recorded winner is the ONE source
    // (see `runtime-env.ts`'s provider) — this value only covers a caller that
    // assembles without a registry (kernel tests, embedders).
    userQuestions: deriveUserQuestions(surface),
    workspace: {
      onChange: async (dir: string) => {
        const k = holder.kernel;
        if (k === undefined) return;
        const skills = await k.setWorkspace(dir);
        await surface.onWorkspaceChanged?.(dir, skills.length);
      },
    },
  });
  holder.kernel = kernel;
  boot?.afterBoot?.(kernel);

  // A provider that cannot enumerate models answers with an empty list — the
  // picker then renders "no models" instead of failing the request path.
  const modelCache = createModelListCache(async () => (await client.listModels?.()) ?? []);
  const theme = m.parsed.themeOverride ?? m.config.ui?.theme ?? 'dark';

  const commands = {
    // The LIVE merged catalog (shell specs + registry commands), so /goal and
    // any third-party registration show up in a surface's menu without this
    // file listing names.
    catalog: () => mergedCommandSpecs(kernel.commands),
    run: (input: string, ui: AgentSurfaceUi): Promise<AgentSurfaceCommandResult> =>
      runAgentCommand(input, {
        kernel,
        client: {
          model: client.model ?? '',
          setModel: (model) => { client.setModel?.(model); },
        },
        config: m.config,
        approvalOverride: m.parsed.approvalOverride,
        fetchModels: () => modelCache(),
        ui,
      }),
  };

  return {
    request: toAgentSurfaceRequest(m, argv),
    kernel,
    commands,
    diagnostics: m.diagnostics.map(toDiagnostic),
    model: () => client.model ?? '',
    listModels: async () => modelCache(),
    ...(m.config.provider?.contextWindow !== undefined ? { contextWindow: m.config.provider.contextWindow } : {}),
    resolveContextWindow: () =>
      createModelMetaStore()
        .lookup(m.config.provider?.model ?? '', m.config.provider?.baseURL ?? '')
        .then((meta) => meta?.contextWindow),
    ...(m.config.autoCompactTokenLimit !== undefined ? { autoCompactTokenLimit: m.config.autoCompactTokenLimit } : {}),
    theme,
    homeDir: os.homedir(),
  };
}

export function toAgentSurfaceRequest(m: SurfaceRequest, argv: readonly string[]): AgentSurfaceRequest {
  return {
    rootDir: m.rootDir,
    argv,
    interactive: m.interactive,
    flags: toFlags(m.parsed),
  };
}

/** The host-owned flags every surface may read (its own opt-ins come from `argv`). */
export function toFlags(parsed: ParsedArgs): AgentSurfaceFlags {
  return {
    ...(parsed.resumeFile !== undefined ? { resumeFile: parsed.resumeFile } : {}),
    ...(parsed.approvalOverride !== undefined ? { approval: parsed.approvalOverride } : {}),
    ...(parsed.themeOverride !== undefined ? { theme: parsed.themeOverride } : {}),
    json: parsed.json,
    repl: parsed.repl,
    web: parsed.web,
    positional: parsed.positional,
  };
}

function toDiagnostic(d: ConfigDiagnostic): AgentSurfaceDiagnostic {
  return { code: d.section, message: `{env:${d.variable}} 未设置` };
}
