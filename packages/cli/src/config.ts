import { errMessage, novaHome, sessionDateBucket, sessionsRoot, userConfigPath } from '@nova-agent/core';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { z } from 'zod';

const configSchema = z.object({
  provider: z.object({
    baseURL: z.string().min(1),
    apiKey: z.string().min(1),
    model: z.string().min(1),
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
  }),
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
   * 界面外观（REPL 呈现层）。theme：dark（默认，配色与引入主题层前
   * 逐字节一致）/ light（亮背景高对比）/ plain（无色）。NO_COLOR 与
   * 非 TTY 恒定无色，主题不生效。
   */
  ui: z
    .object({
      theme: z.enum(['dark', 'light', 'plain']).optional(),
    })
    .optional(),
  tools: z
    .object({
      bash: z
        .object({
          enabled: z.boolean().optional(),
          timeoutMs: z.number().int().positive().optional(),
          shellPath: z.string().optional(),
        })
        .optional(),
      /**
       * PTC 模式（Cloudflare Code Mode，dsh 简化版）：模型针对工具注册表
       * 写 TypeScript 程序经 run_code 在 worker 线程内执行。mode "native"
       * 或缺省=关闭；"ptc"=只暴露 run_code（其余工具降为程序内 SDK 绑定）；
       * "both"=原生调用与程序并存。需要 Node >= 22.19。
       */
      code: z
        .object({
          mode: z.enum(['native', 'ptc', 'both']).optional(),
          maxParallelSubCalls: z.number().int().positive().max(100).optional(),
          computeMs: z.number().int().positive().optional(),
          maxWallMs: z.number().int().positive().optional(),
          maxOutputBytes: z.number().int().positive().optional(),
          maxOldGenerationSizeMb: z.number().int().positive().optional(),
        })
        .optional(),
    })
    .optional(),
  /**
   * 插件 roster（M11 批10）：disable 列出**不加载**的内置插件（名字即
   * `/plugins` 打印的那个），extra 列出额外加载的插件模块（绝对路径、
   * 相对工作目录的路径，或包名）——模块须以 default（或 plugin）导出
   * `{ name, activate }` 形态的插件。这是配置层扩展点：不改源码就能选择、
   * 替换或扩展能力；拼错的 disable 名会告警，加载失败的 extra 直接让启动
   * 失败（静默忽略的扩展比坏掉的启动更糟）。
   */
  plugins: z
    .object({
      disable: z.array(z.string().min(1)).optional(),
      extra: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  /**
   * QQ 机器人模式（nova qqbot）：腾讯机器人开放平台 WebSocket 通道。凭据在
   * q.qq.com 管理端获取；clientSecret 支持 {env:NAME} 引用避免明文入库。
   */
  qqbot: z
    .object({
      appId: z.string().min(1),
      clientSecret: z.string().min(1),
    })
    .optional(),
})
// Strict: a typo'd key ("apporval") is a silent no-op on a lenient schema
// and a confusing wrong-way run. Fail at load with the offending key named.
.strict();

export type Config = z.infer<typeof configSchema>;

/**
 * 路径布局的单一来源是 core 的 `paths.ts`（会话落盘、压缩存档、工具输出都按它解析）——
 * 这里只把 CLI 侧历史导入点转出去，绝不留第二份定义：两份 `novaHome` 漂移过一次，
 * 症状是配置读得到、会话写去别处。
 */
export { novaHome, sessionsRoot, sessionDateBucket, userConfigPath };

/**
 * Expands `{env:NAME}` references. Throws when a referenced variable is
 * unset — the empty-string fallback was a silent footgun (an empty apiKey
 * hit the provider as a 401 with no clue why).
 */
export function expandRefs(value: string): string {
  return value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const v = process.env[name];
    if (v === undefined || v.length === 0) {
      throw new Error(
        `config references environment variable {env:${name}} but it is not set (or empty); set it in your shell or use a literal value`,
      );
    }
    return v;
  });
}

function expandDeep(value: unknown): unknown {
  if (typeof value === 'string') return expandRefs(value);
  if (Array.isArray(value)) return value.map(expandDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = expandDeep(val);
    return out;
  }
  return value;
}

/**
 * Loads ~/.nova/config.json — the ONLY config location. Nothing is ever read
 * from (or written to) the workspace: per-project behaviour comes from where
 * you run nova, not from files planted in it.
 */
export async function loadConfig(homedir: string = os.homedir()): Promise<Config> {
  const file = userConfigPath(homedir);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `missing config: ${file}\ncreate it, e.g.\n{\n  "provider": {\n    "baseURL": "https://api.example.com/v1",\n    "apiKey": "{env:MY_API_KEY}",\n    "model": "model-name"\n  }\n}`,
      );
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in ${file}: ${errMessage(err)}`);
  }
  const expanded = expandDeep(parsed);
  const result = configSchema.safeParse(expanded);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`invalid config ${file}:\n${issues}`);
  }
  return result.data;
}
