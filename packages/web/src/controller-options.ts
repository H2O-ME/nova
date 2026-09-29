import type { ChatProvider, ConfiguredModel, ModelCatalogPort, Plugin, SurfaceRows } from '@nova-agent/core';
import type { Kernel, KernelConfig } from '@nova-agent/plugins';
import type { QqBotRuntime } from './qqbot-frames.js';
import type { WireProviderInput, WireProviderRow } from './provider-wire.js';

/**
 * 控制器选项：**谁提供**、以及内核之外的四个持久化缝（模型、BYOK、插件开关、qqbot）。
 *
 * 从 `options.ts` 拆出，是为了让那个文件只留「启动这一层需要什么」，而把「哪些
 * 数据由宿主落盘」这组**同一条纪律**的注入缝放在这里——它们全都是「只有壳知道配置
 * 文件在哪，所以由壳注入；测试里缺省即代表没有持久化归宿」。
 */

/**
 * The BYOK provider seams, grouped because they are one decision: who owns the
 * provider list and the secret inside it.
 *
 * They are five fields rather than one object because the controller passes each
 * to a different collaborator (`frame-router` → `provider-frames`), and because
 * grouping them in the option type keeps `ControllerOptions` readable while their
 * comments stay next to the field they explain.
 */
export interface ProviderSeams {
  /**
   * The BYOK provider list: its writer, and its on-demand reader. Injected by the
   * shell for the same reason as `persistModels` — only the shell owns the config
   * file — and absent in tests, where the page then reports that it cannot write.
   */
  persistProviders?: (entries: readonly WireProviderInput[], activeId: string | undefined) => void | Promise<void>;
  readProviders?: () => Promise<{ providers: readonly WireProviderRow[]; activeId?: string }>;
  /**
   * The stored API key for one provider id.
   *
   * A function on this seam rather than a field on the snapshot because the key
   * must NEVER reach the browser: the snapshot carries `hasApiKey`, and the host
   * re-reads the real value only when it needs to make a request (a switch, or a
   * re-probe of an already-saved endpoint).
   */
  storedApiKey?: (id: string) => string | undefined | Promise<string | undefined>;
  /**
   * The model id to carry when retargeting an endpoint (config `provider.model`).
   * The shell owns it because the seat is only a view onto the durable answer.
   */
  configuredModel?: () => string | undefined;
}

/**
 * The settings panel's config writers (the plugin manager's + Skill 中心's
 * switches). The shell owns the config file, so it injects the raw-document
 * patchers; absent in tests and in any surface with no durable home for the
 * choice, and the switch methods then throw instead of pretending to persist.
 */
export interface PersistConfigSeams {
  setPluginEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
  /**
   * Replace the `plugins.enable` list wholesale.
   *
   * Distinct from `setPluginEnabled` (which edits `plugins.disable`) because the
   * two lists mean opposite things: `disable` is a veto, `enable` is an opt-in for
   * a tier that defaults to off. An advanced plugin is switched ON by being in
   * `enable` and OFF by being ABSENT from it — writing it into `disable` instead
   * would leave the same name in both tables, and the veto would win, so the
   * operator's "on" would silently do nothing.
   */
  setPluginEnabledList?(names: readonly string[]): Promise<readonly string[]>;
  setSkillEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
}

/** The seams every surface assembles: the endpoint client, plus the writers. */
export interface ControllerOptions extends ProviderSeams {
  rootDir: string;
  /**
   * The endpoint client. OPTIONAL, and that absence is a supported state, not a
   * gap: a first run has nothing configured yet, and the product must reach a
   * usable settings page so the operator can add one. `undefined` means "no
   * endpoint yet" — the UI says so, and the surfaces that cannot work without a
   * client (`nova exec`, `nova qqbot`) refuse at their own entry points rather
   * than pretending.
   */
  provider?: ChatProvider;
  config: KernelConfig;
  /**
   * The running version (the shell's own single source, `cliVersion()`).
   * `ready` carries it so the UI names the build; omitted → the field stays
   * off the wire and the surface keeps its static badge.
   */
  version?: string;
  /** Resume an existing JSONL log as the first session. */
  resumeFile?: string;
  /** Display label for the active model (from config; the surface shows it). */
  providerModelLabel: string;
  /**
   * The catalog's display name for that model, when the shell's metadata store
   * knows one (an id is not a label: `deepseek-v4.1-flash` reads better as
   * "DeepSeek V4.1 Flash"). Omitted → the id is the label.
   */
  providerModelName?: string;
  /**
   * Model context window, when the owning shell knows it (config override or
   * model metadata). The surface only needs the denominator to draw the
   * context gauge; resolving it is the shell's business.
   */
  contextWindow?: number;
  /**
   * Metadata for the model picker (display names + context windows). Omitting
   * it leaves the seat inert: the ids themselves come from the endpoint
   * (`ChatProvider.listModels`), so this port never becomes a second catalog
   * that could disagree with the one actually being served.
   */
  modelCatalog?: ModelCatalogPort;
  /**
   * Remember a model switch past this process. The seat is in-memory by design
   * (it tracks the live client) and only the shell knows the config file that
   * owns the durable answer to "which model", hence the injection.
   */
  persistModel?: (model: string) => void | Promise<void>;
  /**
   * Persist the operator's model list (config `models[]`). Injected by the shell
   * for the same reason as `persistModel` — only the shell knows the config file
   * — and absent in tests, where the settings page then reports that it cannot
   * write rather than pretending to.
   */
  persistModels?: (models: readonly ConfiguredModel[]) => void | Promise<void>;
  /**
   * The model list as stored, re-read on demand. The shell owns the config file,
   * so it also owns this read; a cached copy here would let the page display a
   * list the operator's own hand-edit had already replaced. Absent means "no
   * durable home", and the page then shows the endpoint's catalog only.
   */
  readModels?: () => Promise<readonly ConfiguredModel[]>;
  persistConfig?: PersistConfigSeams;
  /**
   * The qqbot snapshot the panel starts from: the app id, whether a secret is
   * stored, and the `{env:NAME}` reference when the stored text is one. It is an
   * OPTION rather than something the controller reads, because reading the raw
   * config text is the shell's job (see `pluginDiagnostics`); the secret itself
   * never appears here — only whether one exists.
   */
  qqBotConfig?: {
    appId?: string;
    hasClientSecret?: boolean;
    clientSecretRef?: string;
  };
  /**
   * Write the qqbot section (config `qqbot`). `clientSecret` absent means "keep
   * the stored one" — the browser never holds it, so it cannot send it back.
   */
  persistQqBot?: (opts: { appId?: string; clientSecret?: string }) => void | Promise<void>;
  /**
   * Probe the qqbot credentials end to end (token grant + gateway lookup) and
   * resolve with the gateway URL. The browser can only test what the operator
   * typed (it never holds the stored secret), so the candidate secret travels
   * in the request frame and never lands on disk unless the operator saves.
   */
  testQqBot?: (opts: { appId: string; clientSecret: string }) => Promise<string>;
  /**
   * Re-derive the qqbot problem from what is now on disk (the sentence, or
   * undefined when usable). Asked after a save instead of duplicating the
   * `{env:NAME}` rule in the panel: storing ANOTHER unresolved reference leaves
   * the bot just as unusable, so the complaint must not be cleared blindly.
   */
  recheckQqBot?: () => Promise<string | undefined>;
  /**
   * The LIVE QQ channel in this process, when the shell runs one (see
   * `QqBotRuntime`).
   *
   * `recheckQqBot` above answers "are the stored credentials usable", a question
   * about the FILE. This one answers the two the file cannot: is the gateway up
   * (the page draws 未配置 / 已配置但未启动 / 运行中), and what happens AFTER a
   * save — storing credentials is not connecting them, and the channel was built
   * at boot when the file was still empty. Absent (tests, or a shell with no
   * channel) leaves both readings off, as the page rendered before this existed.
   */
  qqBotRuntime?: QqBotRuntime;
  /**
   * Non-fatal config problems, keyed by the PLUGIN-OWNED config section they
   * belong to (`qqbot` today), as ready-to-show sentences.
   *
   * These exist so a plugin's misconfiguration does not stop the surface: the
   * shell resolves `{env:NAME}` references at load, and an unset one inside a
   * plugin-owned section becomes a diagnostic instead of a startup failure. The
   * browser is the only place with room to say what is wrong and which file to
   * edit, so the sentences travel here already written; the key lets the panel
   * that owns a plugin claim its own problem, and keeps the CLI (which owns the
   * user-facing copy) from knowing anything about frames or panels.
   */
  pluginDiagnostics?: Readonly<Record<string, string>>;
  /**
   * Plugins the owning shell contributes to this kernel's roster.
   *
   * The browser surface may not import the QQ channel package (dependency
   * direction: this package depends on core + plugins only), yet that CHANNEL is
   * a plugin this process must host for `nova --web` to answer QQ messages at all.
   * So the shell builds it and hands it over, exactly as it hands over the
   * provider client — this package stays ignorant of every channel.
   */
  extraPlugins?: readonly Plugin[];
  /**
   * Configured surfaces the shell has already loaded, forwarded so the kernel
   * adopts them as ordinary plugin rows — this is what makes a configured
   * surface appear in `/plugins` while `nova --web` is the host. The shell owns
   * the loading (`loadDynamicSurfaces`); this package is ignorant of any surface
   * package, and simply passes through what it is handed.
   */
  surfaces?: SurfaceRows;
  /**
   * Called once with the assembled kernel, before the first session exists.
   *
   * It exists for the extra plugins above: a channel needs the kernel to run a
   * peer turn, but the kernel cannot be built until the channel's plugin is in
   * hand. The shell closes that loop by capturing the kernel here instead of the
   * surface growing a qqbot-shaped hole (see `cli/qqbot-bridge.ts`).
   */
  onKernelReady?: (kernel: Kernel) => void;
}

export interface LaunchWebOptions extends ControllerOptions {
  /** Directory of built frontend assets (vite `dist`). Served at `/`. */
  staticDir: string;
  /** TCP port; 0 (default) picks a free ephemeral port. */
  port?: number;
  /** Bind host. MUST stay a loopback address — the surface is localhost-only. */
  host?: '127.0.0.1' | 'localhost' | '::1';
  /** Called with the full launch URL (token included) once listening. */
  onReady?: (url: string) => void;
}
