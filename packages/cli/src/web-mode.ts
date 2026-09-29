/**
 * `nova --web`（M11 批2）：起单进程 WebUI——同内核句柄（经 @nova-agent/web 的
 * WebController），前端构建产物由该进程静态托管。只打印一次带 launch token 的
 * localhost URL；Ctrl+C 关服务退出。与 repl 共用装配小件（provider/config）。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchWeb } from '@nova-agent/web';
import { cliVersion } from './version.js';
import type { ApprovalMode } from '@nova-agent/plugins';
import type { SurfaceRows } from '@nova-agent/core';
import { diagnosticText, type Config, type ConfigDiagnostic } from './config.js';
import { createProvider, configuredModel, toKernelConfig } from './kernel-boot.js';
import { readProviders, saveProviders, storedApiKey } from './config-providers.js';
import { resolveProvider } from './provider-store.js';
import { testQqBotConnection } from './qqbot-probe.js';
import { startQqBotBridge } from './qqbot-bridge.js';
import { qqBotRuntimeSeam } from './qqbot-activate.js';
import type { Kernel } from '@nova-agent/plugins';
import { createModelCatalogPort } from './model-catalog.js';
import { createModelMetaStore } from './model-meta.js';
import { qqBotConfigProblem, readQqBotSecretRef } from './config-read.js';
import { readModels, saveModels } from './config-models.js';
import { saveModelChoice, saveQqBotConfig, setPluginEnabled, setPluginsEnabled, setSkillEnabled } from './config-write.js';

export interface WebModeOptions {
  rootDir: string;
  config: Config;
  /**
   * Non-fatal problems found while loading the config (`config.ts`). A plugin
   * whose `{env:NAME}` did not resolve is reported in its own settings panel
   * instead of stopping this surface.
   */
  diagnostics: readonly ConfigDiagnostic[];
  /** 固定端口（开发代理流用 NOVA_WEB_PORT）；缺省 = 临时端口。 */
  port?: number;
  resumeFile?: string;
  approvalOverride?: ApprovalMode;
  /**
   * Configured surfaces already loaded (by `loadDynamicSurfaces`), forwarded so
   * the kernel adopts them as ordinary plugin rows — which is what makes a
   * configured surface appear in `/plugins` while `nova --web` is the host.
   */
  surfaces?: SurfaceRows;
}

const require = createRequire(import.meta.url);

/** 前端产物目录：@nova-agent/web 包根下的 public/（dist 的兄弟）。 */
function webStaticDir(): string {
  const entry = require.resolve('@nova-agent/web');
  return path.join(path.dirname(entry), '..', 'public');
}

export async function startWeb(opts: WebModeOptions): Promise<void> {
  const { rootDir, config } = opts;
  // A first run has NO endpoint configured: the product must still start, show
  // the empty shell, and let the settings page write the first provider. So the
  // client is built when one exists and otherwise left out — `provider: undefined`
  // is the honest signal the UI renders as 尚未配置模型端点, and `createProvider`'s
  // throw is reserved for the surfaces that genuinely cannot run without one.
  const endpoint = resolveProvider(config);
  const client = endpoint === undefined ? undefined : await createProvider(config);
  // The kernel needs SOME provider to assemble; `WebController.create` supplies
  // the refusing placeholder when `provider` is absent, so this surface does not
  // have to build one. Absence is what the seat renders as 尚未配置模型端点.
  // The model in force is the CLIENT's, not the config's: `createProvider`
  // reconciled it against the endpoint's own catalog (a config that differs only
  // in case is a name the endpoint does not serve). Everything downstream — the
  // label, the gauge's denominator, the kernel's `llm` service — must read the
  // spelling that will actually be sent.
  const model = client?.model ?? '';
  // The QQ bridge, if the operator configured it: this process is the ONLY one
  // running, so the channel must live here. The kernel is captured later (the
  // channel's plugin has to be part of the assembly), hence the holder.
  let live: Kernel | undefined;
  const qq = await startQqBotBridge(() => live);
  const qqNote = await qq.start();
  if (qqNote !== undefined) console.log(`[qqbot] 未接入：${qqNote}`);
  else console.log('[qqbot] 已接入：凭据有效，本进程内持续收发消息');
  // One metadata store for the whole process: the gauge's denominator and the
  // model picker's labels both read it (cache, offline fallback, best-effort).
  const meta = createModelMetaStore();
  // One lookup at boot: the gauge's denominator (config override first, else
  // the models.dev catalog — an unknown model renders without a percentage
  // rather than guessing a window) and the picker's label for the model in
  // force. Both are the surface's metadata half; best-effort either way.
  const boot =
    endpoint === undefined || model.length === 0
      ? undefined
      : await meta.lookup(model, endpoint.baseURL).catch(() => undefined);
  const contextWindow = endpoint?.contextWindow ?? boot?.contextWindow;
  // Read the raw file once at boot: the reference name is only knowable from the
  // stored text (see `qqBotConfig` below). Best-effort — an unreadable config
  // must not stop the server; the page then shows "已配置" without a variable.
  const secretRef = await readQqBotSecretRef().catch(() => undefined);
  // A plugin-owned reference that did not resolve (`config-expand.ts`) is NOT a
  // reason to refuse this surface: the browser UI does not use the bot's
  // credentials. It IS something the reader must be told, because the settings
  // page would otherwise show a configured-looking bot that cannot connect. The
  // whole run keeps working; only this one panel reports the problem.
  const pluginDiagnostics = Object.fromEntries(
    opts.diagnostics.map((diagnostic) => [diagnostic.section, diagnosticText(diagnostic)]),
  );
  const handle = await launchWeb({
    rootDir,
    // The REAL client when there is one; the placeholder only exists so kernel
    // assembly has a type. Passing `undefined` through is what tells the seat
    // "no endpoint yet" instead of naming a model nobody configured.
    ...(client !== undefined ? { provider: client } : {}),
    version: cliVersion(),
    config: toKernelConfig(config, opts.approvalOverride),
    providerModelLabel: model,
    ...(boot?.displayName !== undefined ? { providerModelName: boot.displayName } : {}),
    // The list reader is LIVE (re-reads the raw file per menu open): the settings
    // page rewrites `models[]` while this process runs, so a captured array would
    // keep offering the pre-edit catalog until a restart.
    modelCatalog: createModelCatalogPort(config, meta, model, () => readModels()),
    // The seat is in-memory by design (it tracks the live client), and the
    // browser cannot hold it either: without a fixed NOVA_WEB_PORT each launch
    // is a new origin, so localStorage would be empty exactly when needed.
    persistModel: (model) => saveModelChoice(model),
    // The settings page's model list: one raw-document writer, and a reader that
    // re-reads the file each time. Both bypass the expanded `Config` for the same
    // reason the qqbot patchers do — the loaded object has already replaced every
    // `{env:NAME}`, and this list is written back.
    persistModels: (models) => saveModels(models),
    readModels: () => readModels(),
    // The settings panel's switches write through the same raw-document
    // patchers (never the expanded Config), so `{env:NAME}` references in the
    // file survive a toggle from the browser. TWO writers, because the roster
    // has two directions: `setPluginEnabled` flips a `standard` row through
    // `plugins.disable`, `setPluginEnabledList` replaces the `plugins.enable`
    // list for an `advanced` row (which ships OFF and is asked for). A surface
    // that supplied only the first could never turn `subagent` back on.
    persistConfig: { setPluginEnabled, setSkillEnabled, setPluginEnabledList: setPluginsEnabled },
    persistQqBot: (opts) => saveQqBotConfig(opts),
    qqBotConfig: {
      ...(config.qqbot?.appId !== undefined ? { appId: config.qqbot.appId } : {}),
      // The secret NEVER crosses into the browser, expanded or otherwise: the
      // panel only learns whether one is set and whether it is a reference.
      // The reference name is read from the RAW document, not from `config`:
      // `loadConfig` runs every string through `expandDeep`, so by now the
      // `{env:NAME}` form has been replaced by the secret itself and the
      // reference is no longer recoverable from what this function holds.
      ...(config.qqbot?.clientSecret !== undefined
        ? {
            hasClientSecret: true,
            ...(secretRef !== undefined ? { clientSecretRef: secretRef } : {}),
          }
        : {}),
    },
    testQqBot: async (opts) => testQqBotConnection(opts),
    recheckQqBot: () => qqBotConfigProblem(),
    // 「保存凭据」与「通道真的跑起来」是两件事：通道在启动时就建好了，那时文件里还
    // 什么都没有，所以光把凭据写进文件不会让任何东西开始收发。设置页存完凭据后问到这里，
    // 由壳把三步做完——插件先在 roster 里打开（`advanced` 默认关，不打开就只有一份工具
    // 注册躺在候选清单里），再重读刚写下的凭据并拨号。
    //
    // 三步的顺序不可颠倒：`setPluginEnabled` 会重 roster，而通道的 brain 要能拿到内核
    // （`live` 在 `onKernelReady` 里回填）；先拨号只会让第一条入站消息撞上未就绪的内核。
    qqBotRuntime: qqBotRuntimeSeam(qq, () => live),
    // ── BYOK：多供应商 ───────────────────────────────────────────────────
    // 整份读写（设置页拥有每一行），且写的是 RAW 文档——`loadConfig` 会把
    // `{env:NAME}` 展开成明文，把解析后的对象写回去等于用密钥替换引用。
    persistProviders: (entries, activeId) => saveProviders(entries, activeId),
    readProviders: () => readProviders(),
    // 密钥只在**服务端需要发请求**时才被取用（切端点、复测已存端点）；快照里
    // 只有 `hasApiKey`，明文永不进浏览器。
    storedApiKey: (id) => storedApiKey(id),
    configuredModel: () => configuredModel(config),
    // ── QQ 机器人 ──────────────────────────────────────────────────────
    // 这个进程是唯一在跑的，所以通道必须挂在这里；`web` 不认识 qqbot（依赖方向），
    // 由壳把插件交过去，并把装配好的内核回填给桥（见 `ControllerOptions.onKernelReady`）。
    // Always offered as a candidate (see `startQqBotBridge`): the plugin page's
    // list is built from candidates, so a channel only constructed on a successful
    // credential check would be invisible exactly when the operator needs to find
    // it. `advanced` means it still loads only when asked for.
    extraPlugins: [qq.plugin],
    onKernelReady: (kernel) => { live = kernel as Kernel; },
    pluginDiagnostics,
    ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
    ...(opts.surfaces !== undefined ? { surfaces: opts.surfaces } : {}),
    staticDir: webStaticDir(),
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
