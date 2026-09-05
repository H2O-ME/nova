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
 * nova 的家：~/.nova/。配置、MCP、技能、会话与缓存全部集中在这里 ——
 * 项目（工作区）永远零写入，也不会出现 .nova/ 目录；工作区只是 nova
 * 运行时所在的当前目录。
 */
export function novaHome(homedir: string = os.homedir()): string {
  return path.join(homedir, NOVA_DIR);
}

export function userConfigPath(homedir: string = os.homedir()): string {
  return path.join(novaHome(homedir), 'config.json');
}

/**
 * ~/.nova/projects/ 下的项目目录名：可读名 + 全路径短哈希。不同盘符/大小写
 * 的同一路径归一后同哈希；重名项目靠哈希区分，互不串数据。
 */
export function projectSlug(rootDir: string, homedir: string = os.homedir()): string {
  const normalized = path.resolve(rootDir).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  const base = path.basename(normalized).replace(/[^a-z0-9_-]+/g, '-') || 'project';
  return `${base}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** 该工作区（运行 nova 的目录）的数据目录：~/.nova/projects/<slug>/，sessions 与 cache 存这里。 */
export function dataDirFor(rootDir: string, homedir: string = os.homedir()): string {
  return path.join(novaHome(homedir), 'projects', projectSlug(rootDir, homedir));
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
