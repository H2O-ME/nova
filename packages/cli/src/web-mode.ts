/**
 * `nova --web`（M11 批2）——浏览器 surface，与其余三家同契约同装配。
 *
 * 本文件只回答两件事：claim（`!--repl && (--web || TTY)`）与**装配前置**
 * （boot：解析端点、建 provider 与模型目录、建 QQ 桥并交出其插件、备好设置页
 * 的写回器），然后把 `{ kernel: runtime.kernel, … }` 交给 `launchWeb`。
 * 「未配置端点也要能起」在这里表达：boot 给装配一个 `unconfiguredProvider()`
 * 占位，首绘因此是设置页而不是拒绝启动。
 *
 * qqbot 是扩展能力：包缺席时整条 QQ 缝降级——没有桥、没有插件行、设置页显示
 * 原因，WebUI 本身照常起。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { errMessage, unconfiguredProvider } from '@nova-agent/core';
import { launchWeb, WebRouteRegistry } from '@nova-agent/web';
import { routeRegistryProvider } from '@nova-agent/plugins';
import type { Kernel } from '@nova-agent/plugins';
import { cliVersion } from './version.js';
import { diagnosticText, type Config, type ConfigDiagnostic } from './config.js';
import { createProvider, configuredModel } from './kernel-boot.js';
import { readProviders, saveProviders, storedApiKey } from './config-providers.js';
import { resolveProvider } from './provider-store.js';
import type { QqBotBridgeLike } from './qqbot-api.js';
import { startQqBotWebBridge, testQqBotConnection } from './qqbot-surface.js';
import { createModelCatalogPort } from './model-catalog.js';
import { createModelMetaStore } from './model-meta.js';
import { qqBotConfigProblem, readQqBotSecretRef } from './config-read.js';
import { readModels, saveModels } from './config-models.js';
import { saveModelChoice, saveQqBotConfig, setPluginEnabled, setPluginsEnabled, setSkillEnabled } from './config-write.js';
import type { BuiltinSurface } from './surface-host.js';

export interface WebSurfaceDeps {
  config: Config;
  /** Non-fatal config problems (`config.ts`): shown per-plugin in the settings page. */
  diagnostics: readonly ConfigDiagnostic[];
}

export function webSurface(deps: WebSurfaceDeps): BuiltinSurface {
  const { config, diagnostics } = deps;
  // boot() 解析、start() 呈现——两者共享的都是「这一进程的事实」。
  const shared: {
    model: string;
    contextWindow?: number;
    providerModelName?: string;
    qq?: QqBotBridgeLike;
    qqMissing?: string;
    secretRef?: string;
    pluginDiagnostics: Record<string, string>;
    /**
     * 通道的 brain 惰性取内核；`afterBoot` 拿到的是**真** `Kernel`
     * （`AgentSurfaceRuntime.kernel` 是给第三方 surface 的结构化窄面，web 是
     * cli 自带的，按真句柄用）。
     */
    live: { kernel?: Kernel };
    /** Plugin asset route registry (built here, fed into the kernel + the HTTP server). */
    routes: WebRouteRegistry;
  } = { model: '', pluginDiagnostics: {}, live: {}, routes: new WebRouteRegistry() };

  return {
    surface: {
      name: 'web',
      interactive: true,
      claim: (request) => !request.flags.repl && (request.flags.web || request.interactive),
      start: async () => {
        const kernel = shared.live.kernel;
        if (kernel === undefined) throw new Error('web：内核尚未装配');
        // 通道的 brain 惰性经 holder 取内核：装配已完成，回填后拨号。
        if (shared.qq !== undefined) {
          const qqNote = await shared.qq.start();
          if (qqNote !== undefined) console.log(`[qqbot] 未接入：${qqNote}`);
          else console.log('[qqbot] 已接入：凭据有效，本进程内持续收发消息');
        } else if (shared.qqMissing !== undefined) {
          console.log(`[qqbot] 未安装：${shared.qqMissing}`);
        }
        const handle = await launchWeb({
          kernel,
          routes: shared.routes,
          version: cliVersion(),
          providerModelLabel: shared.model,
          ...(shared.providerModelName !== undefined ? { providerModelName: shared.providerModelName } : {}),
          ...(shared.contextWindow !== undefined ? { contextWindow: shared.contextWindow } : {}),
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
                  ...(shared.secretRef !== undefined ? { clientSecretRef: shared.secretRef } : {}),
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
          // （`shared.live` 在 afterBoot 里回填）；先拨号只会让第一条入站消息撞上未就绪的内核。
          ...(shared.qq !== undefined ? { qqBotRuntime: shared.qq.runtime(() => shared.live.kernel) } : {}),
          // ── BYOK：多供应商 ───────────────────────────────────────────────────
          // 整份读写（设置页拥有每一行），且写的是 RAW 文档——`loadConfig` 会把
          // `{env:NAME}` 展开成明文，把解析后的对象写回去等于用密钥替换引用。
          persistProviders: (entries, activeId) => saveProviders(entries, activeId),
          readProviders: () => readProviders(),
          // 密钥只在**服务端需要发请求**时才被取用（切端点、复测已存端点）；快照里
          // 只有 `hasApiKey`，明文永不进浏览器。
          storedApiKey: (id) => storedApiKey(id),
          configuredModel: () => configuredModel(config),
          pluginDiagnostics: shared.pluginDiagnostics,
          staticDir: webStaticDir(),
          ...webPort(),
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
      },
    },
    boot: {
      kernel: async () => {
        // A first run has NO endpoint configured: the product must still start, show
        // the empty shell, and let the settings page write the first provider. So the
        // client is built when one exists and otherwise left out — the assembly gets
        // the refusing `unconfiguredProvider()` placeholder instead.
        const endpoint = resolveProvider(config);
        const client = endpoint === undefined ? undefined : await createProvider(config);
        // The model in force is the CLIENT's, not the config's: `createProvider`
        // reconciled it against the endpoint's own catalog (a config that differs only
        // in case is a name the endpoint does not serve). Everything downstream — the
        // label, the gauge's denominator, the kernel's `llm` service — must read the
        // spelling that will actually be sent.
        const model = client?.model ?? '';
        shared.model = model;
        // The QQ bridge, if the operator configured it: this process is the ONLY one
        // running, so the channel must live here. 包缺席 → 整条缝降级：没有桥、
        // 没有插件行，原因挂到设置页的诊断面上。
        try {
          shared.qq = await startQqBotWebBridge(() => shared.live.kernel);
        } catch (err) {
          shared.qq = undefined;
          shared.qqMissing = errMessage(err);
        }
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
        shared.contextWindow = endpoint?.contextWindow ?? boot?.contextWindow;
        shared.providerModelName = boot?.displayName;
        // Read the raw file once at boot: the reference name is only knowable from the
        // stored text (see `qqBotConfig`). Best-effort — an unreadable config must not
        // stop the server; the page then shows "已配置" without a variable.
        shared.secretRef = await readQqBotSecretRef().catch(() => undefined);
        // A plugin-owned reference that did not resolve (`config-expand.ts`) is NOT a
        // reason to refuse this surface: the browser UI does not use the bot's
        // credentials. It IS something the reader must be told, because the settings
        // page would otherwise show a configured-looking bot that cannot connect. The
        // whole run keeps working; only this one panel reports the problem.
        for (const diagnostic of diagnostics) {
          shared.pluginDiagnostics[diagnostic.section] = diagnosticText(diagnostic);
        }
        if (shared.qqMissing !== undefined) shared.pluginDiagnostics['qqbot'] = shared.qqMissing;
        // 壳自带的插件（QQ 通道 + 资产路由注册表）：这里交出去，`web` 包本身
        // 不认识任何渠道。资产路由注册表是 web surface 才需要的容器缝——
        // 插件经 `ctx.must(routes)` 写入，HTTP 处理器经同一个实例分派。
        const extraPlugins = [routeRegistryProvider(shared.routes)];
        if (shared.qq !== undefined) extraPlugins.push(shared.qq.plugin);
        return {
          provider: client ?? unconfiguredProvider(),
          // The list reader is LIVE (re-reads the raw file per menu open): the settings
          // page rewrites `models[]` while this process runs, so a captured array would
          // keep offering the pre-edit catalog until a restart.
          modelCatalog: createModelCatalogPort(config, meta, model, () => readModels()),
          // The settings panel's switches write through the same raw-document
          // patchers (never the expanded Config), so `{env:NAME}` references in the
          // file survive a toggle from the browser. TWO writers, because the roster
          // has two directions: `setPluginEnabled` flips a `standard` row through
          // `plugins.disable`, `setPluginEnabledList` replaces the `plugins.enable`
          // list for an `advanced` row (which ships OFF and is asked for). A surface
          // that supplied only the first could never turn `subagent` back on.
          persistConfig: {
            setPluginEnabled,
            setSkillEnabled,
            setPluginEnabledList: setPluginsEnabled,
          },
          extraPlugins,
        };
      },
      afterBoot: (kernel) => {
        // 通道的 brain（对端轮次）要能在第一条消息到达前拿到内核。
        shared.live.kernel = kernel;
      },
    },
  };
}

/** 前端产物目录：@nova-agent/web 包根下的 public/（dist 的兄弟）。 */
function webStaticDir(): string {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@nova-agent/web');
  return path.join(path.dirname(entry), '..', 'public');
}

/** `NOVA_WEB_PORT` pins the port for the frontend dev-server proxy flow. */
function webPort(): { port?: number } {
  const fixed = Number.parseInt(process.env['NOVA_WEB_PORT'] ?? '', 10);
  return Number.isInteger(fixed) && fixed > 0 ? { port: fixed } : {};
}
