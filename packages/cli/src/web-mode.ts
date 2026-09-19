/**
 * `nova --web`（M11 批2）：起单进程 WebUI——同内核句柄（经 @nova-agent/web 的
 * WebController），前端构建产物由该进程静态托管。只打印一次带 launch token 的
 * localhost URL；Ctrl+C 关服务退出。与 repl 共用装配小件（provider/config）。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchWeb } from '@nova-agent/web';
import type { ApprovalMode } from '@nova-agent/plugins';
import type { Config } from './config.js';
import { createProvider, toKernelConfig } from './kernel-boot.js';
import { createModelMetaStore } from './model-meta.js';

export interface WebModeOptions {
  rootDir: string;
  config: Config;
  /** 固定端口（开发代理流用 NOVA_WEB_PORT）；缺省 = 临时端口。 */
  port?: number;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
}

const require = createRequire(import.meta.url);

/** 前端产物目录：@nova-agent/web 包根下的 public/（dist 的兄弟）。 */
function webStaticDir(): string {
  const entry = require.resolve('@nova-agent/web');
  return path.join(path.dirname(entry), '..', 'public');
}

export async function startWeb(opts: WebModeOptions): Promise<void> {
  const { rootDir, config } = opts;
  const client = createProvider(config);
  // The context gauge needs a denominator: config override first, else the
  // models.dev catalog (best-effort — an unknown model just renders without a
  // percentage rather than guessing a window).
  const contextWindow =
    config.provider.contextWindow ??
    (await createModelMetaStore().lookup(config.provider.model, config.provider.baseURL).catch(() => undefined))?.contextWindow;
  const handle = await launchWeb({
    rootDir,
    provider: client,
    config: toKernelConfig(config, opts.approvalOverride),
    providerModelLabel: config.provider.model,
    ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
    staticDir: webStaticDir(),
    bindSessionAffinity: (sessionId) => client.setSessionId(sessionId),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(opts.port !== undefined ? { port: opts.port } : {}),
  });
  console.log(`Nova WebUI：${handle.url}`);
  console.log('（仅本机可访问；Ctrl+C 停服退出）');
  const shutdown = (): void => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // 常驻：HTTP server 持有事件循环，这里只等它自然结束。
  await new Promise<never>(() => undefined);
}
