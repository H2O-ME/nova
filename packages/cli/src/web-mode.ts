/**
 * `nova --web`（M11 批2）——浏览器 surface，与其余三家同契约同装配。
 *
 * 本文件只回答两件事：claim（`!--repl && (--web || TTY)`）与**装配前置**
 * （boot：解析端点、建 provider 与模型目录、建资产路由注册表并交出其插件、备好
 * 设置页的写回器），然后把 `{ kernel: runtime.kernel, … }` 交给 `launchWeb`。
 * 「未配置端点也要能起」在这里表达：boot 给装配一个 `unconfiguredProvider()`
 * 占位，首绘因此是设置页而不是拒绝启动。
 *
 * QQ 通道**不在这里**：它随 `@nova-agent/qqbot` 那一行插件启停，开关就是那一行的
 * `enabled`（操作者的配置或那一行自己的设置页）。宿主曾经在这里启动时拨号，于是
 * 「行关着、通道照跑」；现在浏览器面不为任何具体插件留位置。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { unconfiguredProvider } from '@nova-agent/core';
import { launchWeb, WebRouteRegistry } from '@nova-agent/web';
import { routeRegistryProvider } from '@nova-agent/plugins';
import type { Kernel } from '@nova-agent/plugins';
import { cliVersion } from './version.js';
import type { Config } from './config.js';
import { loadConfigWithDiagnostics } from './config.js';
import { createProvider, configuredModel } from './kernel-boot.js';
import { readProviders, saveProviders, readActiveProvider, resolveStoredKey } from './config-providers.js';
import { resolveProvider } from './provider-store.js';
import { createModelCatalogPort } from './model-catalog.js';
import { createModelMetaStore } from './model-meta.js';
import { readModels, saveModels, readTitleModel, saveTitleModel } from './config-models.js';
import { readPluginEntryConfig, saveModelChoice, setPluginEntry, setSkillEnabled } from './config-write.js';
import { switchableProvider } from './live-provider.js';
import type { BuiltinSurface } from './surface-host.js';

export interface WebSurfaceDeps {
  config: Config;
}

export function webSurface(deps: WebSurfaceDeps): BuiltinSurface {
  const { config } = deps;
  // boot() 解析、start() 呈现——两者共享的都是「这一进程的事实」。
  const shared: {
    model: string;
    contextWindow?: number;
    providerModelName?: string;
    /**
     * `start()` 拿的是**真** `Kernel`（`AgentSurfaceRuntime.kernel` 是给第三方
     * surface 的结构化窄面，web 是 cli 自带的，按真句柄用），而唯一产出它的地方是
     * `afterBoot`——所以它经这个 holder 回填。
     */
    live: { kernel?: Kernel };
    /**
     * The provider id the boot-time client was built to serve, or undefined when
     * boot built no client (the placeholder shell). The controller tracks the
     * APPLIED id from here: the file's `activeProvider` can name an id the
     * process never applied, and "already in force" must not read the file.
     */
    providerId?: string;
    /** Plugin asset route registry (built here, fed into the kernel + the HTTP server). */
    routes: WebRouteRegistry;
  } = { model: '', live: {}, routes: new WebRouteRegistry() };

  return {
    surface: {
      name: 'web',
      interactive: true,
      claim: (request) => !request.flags.repl && (request.flags.web || request.interactive),
      start: async () => {
        const kernel = shared.live.kernel;
        if (kernel === undefined) throw new Error('web：内核尚未装配');
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
          // reason the plugin patchers do — the loaded object has already replaced every
          // `{env:NAME}`, and this list is written back.
          persistModels: (models) => saveModels(models),
          readModels: () => readModels(),
          // 会话标题模型：同一条 RAW 文档纪律（null = 删键，不是存空串）。
          persistTitleModel: (model) => saveTitleModel(model),
          readTitleModel: () => readTitleModel(),
          // ── BYOK：多供应商 ───────────────────────────────────────────────────
          // 整份读写（设置页拥有每一行），且写的是 RAW 文档——`loadConfig` 会把
          // `{env:NAME}` 展开成明文，把解析后的对象写回去等于用密钥替换引用。
          persistProviders: (entries, activeId) => saveProviders(entries, activeId),
          readProviders: () => readProviders(),
          // 密钥只在**服务端需要发请求**时才被取用（切端点、复测已存端点）；快照里
          // 只有 `hasApiKey`，明文永不进浏览器。`{env:NAME}` 引用在这里展开——磁盘上
          // 是 RAW 引用，服务端请求前是已解析的密钥；未设置的变量被点名拒绝，零 fetch。
          storedApiKey: (id) => resolveStoredKey(id),
          configuredModel: () => configuredModel(config),
          initialProviderId: shared.providerId,
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
          // the empty shell, and let the settings page write the first provider. The
          // assembly gets a SWITCHABLE provider whose initial target is the real
          // client when one exists and the refusing placeholder otherwise — so the
          // settings page's first save can install a client into the SAME instance
          // the kernel's `llm` service already handed out, instead of leaving every
          // session talking to a refusal until a restart.
          const endpoint = resolveProvider(config);
          const client = endpoint === undefined ? undefined : await createProvider(config);
          if (client !== undefined) {
            // The applied id comes from the same reader the page uses (legacy
            // `provider` block → the `default` row, dangling ids fall back) —
            // boot does not re-derive which row is active.
            shared.providerId = (await readProviders().catch(() => undefined))?.activeId;
          }
          const live = switchableProvider(client ?? unconfiguredProvider(), async () => {
            // Rebuild from the FILE (the settings page persisted before this runs).
            const fresh = await loadConfigWithDiagnostics();
            const built = await createProvider(fresh.config);
            if (built.model === '') {
              // No model chosen yet: take the endpoint's own first id rather than
              // send model-less requests. The picker remains the way to change it.
              const available = await built.listModels?.(5_000).catch(() => [] as string[]);
              const first = available?.[0];
              if (first !== undefined) built.setModel(first);
            }
            return built;
          });
          // The model in force is the CLIENT's, not the config's: `createProvider`
          // reconciled it against the endpoint's own catalog (a config that differs only
          // in case is a name the endpoint does not serve). Everything downstream — the
          // label, the gauge's denominator, the kernel's `llm` service — must read the
          // spelling that will actually be sent.
          const model = client?.model ?? '';
          shared.model = model;
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

          // 壳交给内核的额外插件行：只有资产路由注册表——`web` 包本身不认识任何渠道，
          // 每行都带自己 config 用的 id。插件经 `ctx.must(routes)` 写入，HTTP 处理器经
          // 同一个实例分派；没有 per-plugin 特例。
          const extraPlugins = [{ id: 'routes', plugin: routeRegistryProvider(shared.routes) }];
          return {
            provider: live,
          // The list reader is LIVE (re-reads the raw file per menu open): the settings
          // page rewrites `models[]` while this process runs, so a captured array would
          // keep offering the pre-edit catalog until a restart. The ACTIVE provider's
          // own list wins when it carries one — the menu must describe the endpoint
          // the requests actually go to (A and B often share ids, rarely meanings).
          modelCatalog: createModelCatalogPort(
            config,
            meta,
            model,
            () => readModels(),
            () => readActiveProvider(),
          ),
          // The settings panel's switches write through the same raw-document
          // patchers (never the expanded Config), so `{env:NAME}` references in the
          // file survive a toggle from the browser. There is ONE row writer, addressed
          // by row id: a plugin page and the plugin manager's switch edit the same
          // field, so they cannot disagree about what is on.
          persist: {
            // The reference-preserving reader: a plugin's own page echoes the
            // `{env:NAME}` it wrote, never the secret `loadConfig` expanded.
            readPluginEntry: (id) => readPluginEntryConfig(id),
            setPluginEntry: (id, patch) => setPluginEntry(id, patch),
            setSkillEnabled: (name, enabled) => setSkillEnabled(name, enabled),
            // The tree's LIVE read, expanded exactly as the boot config was: a row
            // switch wrote the file, so the roster that follows it must read the
            // file rather than the snapshot taken at assembly. Expanded (not raw)
            // because this is what goes to a plugin's own `Config` schema — the raw
            // form would hand it the literal `{env:NAME}` the writer preserved.
            readPluginEntries: async () => (await loadConfigWithDiagnostics()).config.plugins?.entries ?? [],
          },
          extraPlugins,
        };
      },
      afterBoot: (kernel) => {
        // `start()` 要的是真 `Kernel`；装配完成即回填（holder 是这条回边唯一的住处）。
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
