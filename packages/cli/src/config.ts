import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const NOVA_DIR = '.nova';

const configSchema = z.object({
  provider: z.object({
    baseURL: z.string().min(1),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    /** Sampling temperature passed through to the provider. */
    temperature: z.number().min(0).max(2).optional(),
    /** Passed through as `max_tokens` when set. */
    maxTokens: z.number().int().positive().max(1_000_000).optional(),
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
  tools: z
    .object({
      bash: z
        .object({
          enabled: z.boolean().optional(),
          timeoutMs: z.number().int().positive().optional(),
          shellPath: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof configSchema>;

/**
 * nova 的家：~/.nova/。配置、技能、会话与缓存全部集中在这里 ——
 * 项目（工作区）永远零写入，也不会出现 .nova/ 目录；工作区只是 nova
 * 运行时所在的当前目录。
 */
export function novaHome(homedir: string = os.homedir()): string {
  return path.join(homedir, NOVA_DIR);
}

export function userConfigPath(homedir: string = os.homedir()): string {
  return path.join(novaHome(homedir), 'config.json');
}

/** 会话根目录（codex 式按日期归档）：~/.nova/sessions/YYYY/MM/DD/sess_<id>.jsonl。 */
export function sessionsRoot(homedir: string = os.homedir()): string {
  return path.join(novaHome(homedir), 'sessions');
}

/** 新会话落盘的日期桶（创建时取当天，跨天启动自动换目录）。 */
export function sessionDateBucket(now: Date = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

/** Expands `{env:NAME}` references; unset variables expand to an empty string. */
export function expandRefs(value: string): string {
  return value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    return process.env[name] ?? '';
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
    throw new Error(`invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}`);
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
