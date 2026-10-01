/**
 * 测试侧的装配器：按「壳」的形状先装内核，再交给 controller。
 *
 * 生产里的装配只有一处（`cli/kernel-boot.ts` 的 `bootKernel`，P4 起 web 也走它）；
 * web 测试不依赖 cli，所以这里做同一件事的最小版——两步（内核 → controller），
 * 壳侧选项（rootDir / provider / config / modelCatalog / persistConfig / …）与
 * controller 选项（persistModel / qqbot 缝 / …）在这一处分流。后续接口变化只改
 * 这一处，测试文件不必各自抄装配。
 */
import {
  unconfiguredProvider,
  type ChatProvider,
  type ModelCatalogPort,
  type Plugin,
  type SurfaceRows,
} from '@nova-agent/core';
import { createAgentKernel, type CreateKernelOptions } from '@nova-agent/plugins';
import { WebController } from '../src/controller.js';
import type { ControllerOptions } from '../src/options.js';

/** 壳侧装配选项（测试用到的子集）。 */
export interface KernelRigOptions {
  rootDir: string;
  provider?: ChatProvider;
  config?: CreateKernelOptions['config'];
  resumeFile?: string;
  sessionDir?: string;
  extraPlugins?: readonly Plugin[];
  surfaces?: SurfaceRows;
  modelCatalog?: ModelCatalogPort;
  persistConfig?: CreateKernelOptions['persistConfig'];
  /** 扩展包的 spec 覆写（测试注入缺失模块，见 `extensions.ts`）。 */
  extensionSpecs?: CreateKernelOptions['extensionSpecs'];
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
    persistConfig,
    extensionSpecs,
    ...controllerOpts
  } = opts;
  const kernel = await createAgentKernel({
    rootDir,
    provider: provider ?? unconfiguredProvider(),
    config,
    // 浏览器是有人的界面（与壳的 web-mode 同一条声明）：ask_user_question
    // 在这里必须可答，否则提问轮会停在无人应答的等待里。
    userQuestions: true,
    ...(resumeFile !== undefined ? { resumeFile } : {}),
    ...(sessionDir !== undefined ? { sessionDir } : {}),
    ...(extraPlugins !== undefined ? { extraPlugins: [...extraPlugins] } : {}),
    ...(surfaces !== undefined ? { surfaces } : {}),
    ...(modelCatalog !== undefined ? { modelCatalog } : {}),
    ...(persistConfig !== undefined ? { persistConfig } : {}),
    ...(extensionSpecs !== undefined ? { extensionSpecs } : {}),
  });
  return WebController.create({ kernel, ...controllerOpts });
}
