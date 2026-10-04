/**
 * Test-side assembly: build a kernel the way the shell does, then hand it to the
 * controller.
 *
 * Production has exactly ONE assembly (`cli/kernel-boot.ts`'s `bootKernel`, which
 * web also goes through), and the web tests do not depend on `cli` — so this is
 * the minimal version of the same two steps (kernel → controller). The shell-side
 * options (rootDir / provider / config / modelCatalog / persist / …) and the
 * controller options split here, so a future interface change is fixed in ONE
 * place instead of being hand-copied by every test file.
 *
 * The option names must match `CreateKernelOptions` exactly: a rig field the
 * kernel does not know is silently dropped (tests are not typechecked), which is
 * how three of these files kept driving options that had been deleted.
 */
import {
  unconfiguredProvider,
  type ChatProvider,
  type ModelCatalogPort,
  type PluginEntryOptions,
  type SurfaceRows,
} from '@nova-agent/core';
import { createAgentKernel, type CreateKernelOptions } from '@nova-agent/plugins';
import { WebController } from '../src/controller.js';
import type { ControllerOptions } from '../src/options.js';

/** The shell-side assembly options (the subset these tests use). */
export interface KernelRigOptions {
  rootDir: string;
  provider?: ChatProvider;
  config?: CreateKernelOptions['config'];
  resumeFile?: string;
  sessionDir?: string;
  extraPlugins?: readonly PluginEntryOptions[];
  surfaces?: SurfaceRows;
  modelCatalog?: ModelCatalogPort;
  /** The config file, as this kernel may touch it (`plugins.entries` writes). */
  persist?: CreateKernelOptions['persist'];
}

export type ControllerRigOptions = Omit<ControllerOptions, 'kernel'> & KernelRigOptions;

/** Assemble a kernel the way the shell does, then create the controller over it. */
export async function bootController(opts: ControllerRigOptions): Promise<WebController> {
  const {
    rootDir,
    provider,
    config = { approval: 'read-only' },
    resumeFile,
    sessionDir,
    extraPlugins,
    surfaces,
    modelCatalog,
    persist,
    ...controllerOpts
  } = opts;
  const kernel = await createAgentKernel({
    rootDir,
    provider: provider ?? unconfiguredProvider(),
    config,
    // The browser is a surface WITH a person (the same declaration the shell's
    // web-mode makes): `ask_user_question` must be answerable here, or a run
    // parks in a wait no card can release.
    userQuestions: true,
    ...(resumeFile !== undefined ? { resumeFile } : {}),
    ...(sessionDir !== undefined ? { sessionDir } : {}),
    ...(extraPlugins !== undefined ? { extraPlugins: [...extraPlugins] } : {}),
    ...(surfaces !== undefined ? { surfaces } : {}),
    ...(modelCatalog !== undefined ? { modelCatalog } : {}),
    ...(persist !== undefined ? { persist } : {}),
  });
  return WebController.create({ kernel, ...controllerOpts });
}
