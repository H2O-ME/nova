import { errMessage, novaHome, sessionDateBucket, sessionsRoot, userConfigPath } from '@nova-agent/core';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { z } from 'zod';
import { modelsSchema, providersSchema } from './config-schema-models.js';
import { expandConfigDocument, type ConfigDiagnostic } from './config-expand.js';

export { expandRefs, diagnosticText, unresolvedRef } from './config-expand.js';
export type { ConfigDiagnostic } from './config-expand.js';
export { modelEntrySchema, modelsSchema, providerEntrySchema, providersSchema } from './config-schema-models.js';

const configSchema_ = z.object({
  /**
   * 在役供应商（历史字段，仍是**唯一**「当前用哪个端点」的答案）。
   *
   * 它现在是**可选**的：初次使用就是空壳——装好就能启动，由设置页填端点与密钥。
   * 缺失时各 surface 报「尚未配置模型端点」而不是启动失败（见 `resolveProvider`）。
   * `providers` 非空时，这个对象的 `baseURL` / `apiKey` 由激活项派生（见
   * `provider-store.ts`），此处保留是为了让老配置**逐字节继续可用**。
   *
   * `model` 同样可选：镜像块的 model 属于「当前模型」存储（模型选择器写它），
   * 而设置页第一次保存供应商时它还不存在——要求它存在会把首次保存变成
   * 「存得下、起不来」。读者（`createProvider` / `configuredModel`）本就容忍缺省。
   */
  provider: z
    .object({
      baseURL: z.string().min(1),
      apiKey: z.string().min(1),
      model: z.string().min(1).optional(),
      /** Sampling temperature passed through to the provider. */
      temperature: z.number().min(0).max(2).optional(),
      /** Passed through as `max_tokens` when set. */
      maxTokens: z.number().int().positive().max(1_000_000).optional(),
      /**
       * Context window size (prompt tokens). Normally resolved from
       * https://models.dev/api.json by model id; set this to override/兜底 for
       * self-hosted or unlisted models so the surface's context gauge has a denominator.
       */
      contextWindow: z.number().int().positive().max(200_000_000).optional(),
    })
    .strict()
    .optional(),
  /**
   * 供应商清单（BYOK 多端点）。每一项是一个**独立的 OpenAI 兼容端点**，各有自己的
   * baseURL / apiKey / 采样参数 / 上下文窗口覆盖——「只支持 api.tianhw.top」的解药。
   *
   * `activeProvider` 指名当前在役的那一项（缺省取列表第一项）。`provider` 与它同时
   * 存在时**以它为准**：那是操作者在设置页刚点过的答案，比手写的 `provider` 新。
   * `id` 是稳定标识（改名不改绑定），`name` 只用于显示。
   *
   * 形状定义在 `config-schema-models.ts`（与顶层 `models[]` 共用同一个 schema）。
   */
  providers: providersSchema,
  /** 当前在役供应商的 `id`；缺省或指向不存在的项时取列表第一项。 */
  activeProvider: z.string().min(1).optional(),
  /**
   * 模型目录（设置页「模型」的可编辑面）。**非空即接管**：此时列表就是菜单的全部
   * 内容——端点没公布的模型也能加进来（自建/网关私有名字），不想要的删掉即可；缺省
   * 时沿用「端点 `GET /models` 公布 + models.dev 元数据」的自动目录。
   *
   * 每项的能力字段是**逐字段覆盖**，不是重述：只写 `id` 的条目照样从 models.dev 取
   * 窗口与多模态，所以手改能力是「按需选字段」，而不是「每个模型都要抄一遍」。三个
   * 来源的权威顺序：这里写的 > models.dev > 未知（未知是真答案：仪表不画百分比，
   * 而不是猜一个窗口）。形状见 `config-schema-models.ts`。
   */
  models: modelsSchema,
  systemPrompt: z.string().optional(),
  maxTurns: z.number().int().positive().max(500).optional(),
  approval: z.enum(['read-only', 'auto-edit', 'full']).optional(),
  /**
   * 系统通知开关（审批请求 / 长任务完成 / 出错时弹 Windows toast 等系统
   * 通知）。默认开启；设为 false 或环境变量 NOVA_NO_NOTIFY=1 关闭。
   */
  notify: z.boolean().optional(),
  /**
   * Auto-compact threshold in prompt tokens (measured on the latest turn).
   * When exceeded, the session is summarized and restarted automatically
   * (codex-style model_auto_compact_token_limit). Unset disables it.
   */
  autoCompactTokenLimit: z.number().int().positive().max(2_000_000).optional(),
  /**
   * 注入每个会话首条消息的 AGENTS.md 链的 token 预算。以 token 而非字节计：估算器
   * 对中日韩字符约 1 token/字、其余约 1 token/4 字，按字节设限会让同一份中文文档
   * 被静默按数倍计价。缺省 PROJECT_DOC_MAX_TOKENS（8000）。
   */
  projectDocMaxTokens: z.number().int().positive().max(1_000_000).optional(),
  /**
   * 会话标题模型：在役端点上的一个模型 id。每段会话的**第一条真实提示词**落盘后，
   * 用它起一个短标题（log-only 的 `title` 标记），会话清单（浏览器侧栏、QQ
   * `/sessions`）显示它而不是首条提示词原文。缺省不生成；生成失败或不在线都只是
   * 回落到首条提示词，绝不影响那一轮。
   */
  titleModel: z.string().min(1).optional(),
  /**
   * 界面外观（REPL 呈现层）。theme：dark（默认，配色与引入主题层前
   * 逐字节一致）/ light（亮背景高对比）/ plain（无色）。NO_COLOR 与
   * 非 TTY 恒定无色，主题不生效。
   */
  ui: z
    .object({
      theme: z.enum(['dark', 'light', 'plain']).optional(),
    })
    .strict()
    .optional(),
  // The former `tools.bash` block is GONE, deliberately: it was accepted by
  // this schema for a long time but had NO reader — the bash tool takes its
  // settings from its own row's `config` in `plugins.entries`
  // (`{ id: "bash", config: { timeoutMs, shellPath } }`), and a top-level
  // block the kernel never reads is the "looks saved, does nothing" failure
  // mode this strict schema exists to prevent. Accepting it silently was the
  // bug; refusing it at load — naming the key — is the honest answer, and the
  // config example in AGENTS.md shows the row form.
  /**
   * 插件树：唯一的插件配置入口。
   *
   * 每行 `{ id, enabled?, config? }`——`id` 是内置插件的名字或一个模块 spec，
   * `enabled` 是**唯一的**开关。曾经有 `disable` / `enable` 两张表加若干
   * 「推导录取口」，三处判定同一件事，于是关掉的插件会被别处复活：两张表能
   * 互相矛盾，而配置推导（`tools.code.mode`、`qqbot` 块）又能越过两张表。
   * 现在只有一份真相：启动路径与设置面板写的是同一个字段。
   *
   * 行的 `config` 由**那个插件自己的** `Config` schema 校验——内核不知道
   * bash 有没有超时，也不该知道。
   */
  plugins: z
    .object({
      entries: z
        .array(
          z
            .object({
              id: z.string().min(1),
              enabled: z.boolean().optional(),
              config: z.unknown().optional(),
            })
            .strict(),
        )
        // Duplicate ids are ambiguous BY CONSTRUCTION and the ambiguity is not
        // even consistent: the settings writer edits the FIRST row with an id
        // while the runtime tree maps rows by id (LAST one wins) — so a
        // duplicate could mean the operator's switch and the running row
        // disagree. Named refusal at load, not a silent pick of one.
        .superRefine((rows, ctx) => {
          const seen = new Set<string>();
          for (const row of rows) {
            if (seen.has(row.id)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `plugins.entries 有重复的插件 id "${row.id}"（同一个插件只能有一行）`,
              });
              return;
            }
            seen.add(row.id);
          }
        })
        .optional(),
    })
    .strict()
    .optional(),
  /**
   * Skills 开关（设置面板「Skill 中心」的可视写入面）：disable 按 skill 名全局
   * 关闭——项目级与用户级同名 skill 一律不再注入 `<available_skills>` 索引与
   * `skill` 工具。拼错的名字在装配时告警（与 plugins.entries 里点错 id 同一条纪律）。
   */
  skills: z
    .object({
      disable: z.array(z.string().min(1)).optional(),
    })
    .strict()
    .optional(),
  /**
   * 表面插件（surface 插件）——配置层动态加载的人机界面入口。每条是一个
   * 模块规格（绝对路径 / 相对工作目录的路径 / 裸包名），由 `loadSurfacePlugins`
   * 动态 `import()`，其 `default`（或 `surface`）导出须是 `AgentSurface`。与
   * `plugins.entries` 同一套解析规则（见 `module-spec.ts`）。
   *
   * cli 源码不依赖任何 surface 包——这里只是配置声明模块 id，第三方
   * surface 写法相同：写一行包名即可替换或新增界面，不必改源码。
   */
  surfaces: z.array(z.string().min(1)).optional(),
})
// Strict at every level: a typo'd key ("apporval", "temprature",
// "plugins.entrys") is a silent no-op on a lenient schema and a confusing
// wrong-way run. Fail at load with the offending key named.
.strict();

/**
 * The config schema, exported for the RAW-document writers (`config-doc.ts`):
 * every writer validates the unexpanded document BEFORE its atomic commit, so
 * a settings save that would produce an unbootable file is refused at the
 * save — with the file untouched — instead of being discovered at the next
 * start, when the operator who made the mistake is no longer looking.
 */
export const configSchema = configSchema_;

export type Config = z.infer<typeof configSchema>;

/**
 * 路径布局的单一来源是 core 的 `paths.ts`（会话落盘、压缩存档、工具输出都按它解析）——
 * 这里只把 CLI 侧历史导入点转出去，绝不留第二份定义：两份 `novaHome` 漂移过一次，
 * 症状是配置读得到、会话写去别处。
 */
export { novaHome, sessionsRoot, sessionDateBucket, userConfigPath };

/**
 * The loaded config plus what was wrong with it without being fatal.
 *
 * `diagnostics` is non-empty when a PLUGIN-owned section (see `config-expand.ts`)
 * holds an unset `{env:NAME}`. The value is left as written in the returned
 * config, so the owning plugin reports it where it is actually needed and every
 * other surface only has to display it.
 */
export interface LoadedConfig {
  readonly config: Config;
  readonly diagnostics: readonly ConfigDiagnostic[];
}

/**
 * Loads ~/.nova/config.json — the ONLY config location — together with the
 * non-fatal problems found while expanding it. Nothing is ever read from (or
 * written to) the workspace: per-project behaviour comes from where you run
 * nova, not from files planted in it.
 *
 * **A MISSING file is an empty shell, not an error.** First run must reach a
 * usable product with no hand-written JSON: the operator configures an endpoint
 * in the settings page, which writes the file. An absent file therefore loads as
 * `{}`, and the surfaces that need an endpoint report 尚未配置模型端点 where the
 * reader can act on it (see `resolveProvider`). A file that EXISTS but is
 * malformed still throws — that is a config the operator wrote and got wrong,
 * and silently replacing it with defaults would hide the mistake.
 *
 * A core section's unresolved `{env:NAME}` still throws (see `config-expand.ts`);
 * only a plugin-owned section degrades to a diagnostic, so one unconfigured
 * plugin can no longer stop the whole product from starting.
 *
 * @param homedir - the home directory to resolve `~/.nova` under.
 * @returns the config and its diagnostics.
 */
export async function loadConfigWithDiagnostics(homedir: string = os.homedir()): Promise<LoadedConfig> {
  const file = userConfigPath(homedir);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      // The empty shell: no file at all is the supported first-run state.
      return { config: configSchema.parse({}), diagnostics: [] };
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in ${file}: ${errMessage(err)}`);
  }
  const { value: expanded, diagnostics } = expandConfigDocument(parsed);
  const result = configSchema.safeParse(expanded);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`invalid config ${file}:\n${issues}`);
  }
  return { config: result.data, diagnostics };
}

/**
 * Loads ~/.nova/config.json, discarding the diagnostics.
 *
 * Use this where a non-fatal plugin problem is irrelevant to the caller (a
 * `qqbot` diagnostic does not change what the REPL does). Callers that can SHOW
 * a diagnostic — the browser surface, the settings panel — must use
 * `loadConfigWithDiagnostics` instead, or the reader never learns why a plugin
 * is unavailable.
 *
 * @param homedir - the home directory to resolve `~/.nova` under.
 * @returns the parsed config.
 */
export async function loadConfig(homedir: string = os.homedir()): Promise<Config> {
  return (await loadConfigWithDiagnostics(homedir)).config;
}
