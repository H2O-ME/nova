/**
 * The surface host: the half of assembly the cli owns (kernel + provider + the
 * one slash-command runner) and the adapter that hands a dynamically-loaded
 * `AgentSurface` the runtime it needs. A surface plugin consumes this through
 * core types only; the cli never imports the surface package.
 *
 * The kernel is assembled exactly once here and the surface drives its own
 * lifecycle (`start` cleans up); the cli derives the fail-closed `userQuestions`
 * flag from the surface's own declaration (`answersQuestions`/`interactive`) so
 * the three-hand-copied-lines hazard of the old per-site assembly cannot recur.
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
} from '@nova-agent/core';
import { createAgentKernel, type Kernel } from '@nova-agent/plugins';
import type { ParsedArgs } from './cli-args.js';
import type { ThemeName } from './command-core.js';
import { runAgentCommand, type CommandPorts } from './command-runner.js';
import { COMMAND_SPECS, createModelListCache } from './commands.js';
import type { ConfigDiagnostic } from './config.js';
import { createProvider, toKernelConfig } from './kernel-boot.js';
import { createModelMetaStore } from './model-meta.js';
import type { SurfaceRequest } from './surfaces.js';

/** Resolve an `AgentSurface` invocation: assemble the kernel, then run the surface. */
export async function runSurface(surface: AgentSurface, m: SurfaceRequest, argv: readonly string[]): Promise<void> {
  const runtime = await buildSurfaceRuntime(surface, m, argv);
  // The surface owns its teardown (`app.stop()` before kernel/jobs dispose); the
  // host stops here once `start` resolves.
  await surface.start(runtime);
}

export async function buildSurfaceRuntime(
  surface: AgentSurface,
  m: SurfaceRequest,
  argv: readonly string[],
): Promise<AgentSurfaceRuntime> {
  const client = await createProvider(m.config);
  // `workspace.onChange` is bound before the kernel exists, so the holder is
  // what makes that honest — same shape as the old `tui-mode.ts` holder.
  const holder: { kernel?: Kernel } = {};
  const kernel = await createAgentKernel({
    rootDir: m.rootDir,
    provider: client,
    config: toKernelConfig(m.config, m.parsed.approvalOverride),
    ...(m.parsed.resumeFile !== undefined ? { resumeFile: m.parsed.resumeFile } : {}),
    ...(m.surfaces !== undefined ? { surfaces: m.surfaces } : {}),
    // Fail-closed by default; a surface with a person at the end opts in once,
    // here — not as a hand-copied line at every assembly site. The derivation
    // itself lives in core (`deriveUserQuestions`) so the service provider in
    // `plugins/runtime-env` and this site can never disagree.
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

  const themeHolder: { theme: ThemeName } = {
    theme: (m.parsed.themeOverride ?? m.config.ui?.theme ?? 'dark') as ThemeName,
  };
  const modelCache = createModelListCache(() => client.listModels());

  const commands = {
    catalog: () => COMMAND_SPECS,
    run: (input: string, ui: AgentSurfaceUi): Promise<AgentSurfaceCommandResult> =>
      runAgentCommand(input, toCommandPorts(kernel, client, m, ui, themeHolder, modelCache)),
  };

  return {
    request: toAgentSurfaceRequest(m, argv),
    kernel,
    commands,
    diagnostics: m.diagnostics.map(toDiagnostic),
    model: () => client.model,
    listModels: async () => modelCache(),
    ...(m.config.provider?.contextWindow !== undefined ? { contextWindow: m.config.provider.contextWindow } : {}),
    resolveContextWindow: () =>
      createModelMetaStore()
        .lookup(m.config.provider?.model ?? '', m.config.provider?.baseURL ?? '')
        .then((meta) => meta?.contextWindow),
    ...(m.config.autoCompactTokenLimit !== undefined ? { autoCompactTokenLimit: m.config.autoCompactTokenLimit } : {}),
    theme: m.parsed.themeOverride ?? m.config.ui?.theme ?? 'dark',
    homeDir: os.homedir(),
  };
}

function toCommandPorts(
  kernel: Kernel,
  client: { readonly model: string; setModel(model: string): void },
  m: SurfaceRequest,
  ui: AgentSurfaceUi,
  themeHolder: { theme: ThemeName },
  modelCache: () => Promise<string[]>,
): CommandPorts {
  return {
    kernel,
    client,
    config: m.config,
    approvalOverride: m.parsed.approvalOverride,
    theme: () => themeHolder.theme,
    setTheme: (theme: ThemeName) => {
      themeHolder.theme = theme;
      ui.setTheme(theme);
    },
    note: (text, tone) => ui.note(text, tone),
    fetchModels: () => modelCache(),
    pickModel: (models) => ui.pickModel(models),
    bindSession: (agent) => ui.bindSession(agent),
    clear: () => ui.clear(),
    modeHint: ui.modeHint,
    exit: () => ui.exit(),
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

function toFlags(parsed: ParsedArgs): AgentSurfaceFlags {
  return {
    ...(parsed.resumeFile !== undefined ? { resumeFile: parsed.resumeFile } : {}),
    ...(parsed.approvalOverride !== undefined ? { approval: parsed.approvalOverride } : {}),
    ...(parsed.themeOverride !== undefined ? { theme: parsed.themeOverride } : {}),
    json: parsed.json,
    repl: parsed.repl,
    web: parsed.web,
    tui: parsed.tui,
    positional: parsed.positional,
  };
}

function toDiagnostic(d: ConfigDiagnostic): AgentSurfaceDiagnostic {
  return { code: d.section, message: `{env:${d.variable}} 未设置` };
}
