import type { ConfiguredModel, RouteRegistry } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import type { PickFn } from './picker-frames.js';
import type { StoredKeyResolution } from './provider-frames.js';
import type { WireProviderInput, WireProviderRow } from './provider-wire.js';

/**
 * 控制器选项：**谁提供**、以及内核之外的三个持久化缝（模型、BYOK、插件开关）。
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
   * The stored API key for one provider id, RESOLVED for use in a request: the
   * key, or the named reason there is none (`{env:NAME}` unset → `env-unset`
   * with the variable's name, a refused request rather than a garbage fetch).
   *
   * A function on this seam rather than a field on the snapshot because the key
   * must NEVER reach the browser: the snapshot carries `hasApiKey`, and the host
   * re-reads the real value only when it needs to make a request (a switch, or a
   * re-probe of an already-saved endpoint).
   */
  storedApiKey?: (id: string) => StoredKeyResolution | Promise<StoredKeyResolution>;
  /**
   * The provider id the live client booted serving; undefined when boot built no
   * client (the placeholder shell). The controller tracks the applied id from
   * here — "which provider is in force" is a fact about the process, and the
   * file's `activeProvider` can name an id the process never applied.
   */
  initialProviderId?: string;
  /**
   * The model id to carry when retargeting an endpoint (config `provider.model`).
   * The shell owns it because the seat is only a view onto the durable answer.
   */
  configuredModel?: () => string | undefined;
}

/**
 * The settings panel's own config writers: 插件管理's switches and Skill 中心's.
 *
 * The shell owns the config file, so it injects the raw-document patchers;
 * absent in tests and in any surface with no durable home for the choice, and
 * the switch methods then throw instead of pretending to persist.
 *
 * One plugin writer, not two. There used to be a pair here (one editing
 * `plugins.disable`, one replacing `plugins.enable`) because the config kept two
 * lists meaning opposite things; with ONE `plugins.entries` list a row owns its
 * own switch, so the distinction — and the "same name in both tables" trap the
 * pair existed to describe — is gone.
 */
export interface PersistConfigSeams {
  /** Flip one roster row's own switch; returns the disabled ids now in force. */
  setPluginEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
  setSkillEnabled(name: string, enabled: boolean): Promise<readonly string[]>;
}

/**
 * The seams the browser surface runs on: the ASSEMBLED KERNEL plus the
 * persistence seams only the shell can supply.
 *
 * 装配权归壳：controller **不**再调用 `createAgentKernel`。这样「谁装内核」全仓
 * 只有一处（`cli/kernel-boot.ts` 的 `bootKernel`），web 面与 exec / repl / qqbot
 * 共用同一段装配（含 modelCatalog / persistConfig / extraPlugins / surfaces 的
 * 转发），三个装配点收敛为一条入口——此前 web 自装一份，正是「新选项被静默丢掉」
 * 与「两处模型元数据实现」的温床。
 */
export interface ControllerOptions extends ProviderSeams {
  /** The assembled kernel. The controller consumes it; it never builds one. */
  kernel: Kernel;
  /**
   * The running version (the shell's own single source, `cliVersion()`).
   * `ready` carries it so the UI names the build; omitted → the field stays
   * off the wire and the surface keeps its static badge.
   */
  version?: string;
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
  /**
   * Override the host's native file/folder dialog (`pick_file` /
   * `pick_directory`). Absent in production — the real dialog from
   * `native-picker.ts` answers; tests inject a fake so no OS dialog ever opens.
   */
  pickPath?: PickFn;
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
  /**
   * The plugin asset route registry. The SAME instance is provided to the
   * kernel container (via `routeRegistryProvider`) so plugins register their
   * prefixes from `apply(ctx)`; the host's request handler then dispatches
   * through it before falling back to its own handlers. Absent in tests and in
   * any surface whose shell did not wire the seam — the server then serves as
   * usual and plugin UI capabilities degrade.
   */
  routes?: RouteRegistry;
}
