import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const NOVA_DIR = '.nova';

/**
 * `.nova/mcp.json` — GOALS §6 format. Example:
 * {
 *   "mcp": {
 *     "fathom": {
 *       "type": "remote",
 *       "url": "https://fathomsearch.xyz/mcp",
 *       "enabled": true,
 *       "headers": { "X-API-KEY": "{env:FATHOM_API_KEY}" }
 *     },
 *     "files": {
 *       "type": "stdio",
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
 *     }
 *   }
 * }
 * String values support `{env:NAME}` and `{file:path}` reference expansion
 * (file paths resolve relative to the config file's directory).
 */

const baseServer = {
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
};

const remoteServer = z.object({
  ...baseServer,
  type: z.literal('remote'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
});

const stdioServer = z.object({
  ...baseServer,
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
});

const serverSchema = z.discriminatedUnion('type', [remoteServer, stdioServer]);
const mcpFileSchema = z.object({ mcp: z.record(z.string(), serverSchema) });

export type RemoteServerConfig = z.infer<typeof remoteServer>;
export type StdioServerConfig = z.infer<typeof stdioServer>;
export type McpServerSpec = z.infer<typeof serverSchema>;
export type McpServerConfig = McpServerSpec & {
  /** Server key from the config file. */
  name: string;
};

export function mcpConfigPath(rootDir: string): string {
  return path.join(rootDir, NOVA_DIR, 'mcp.json');
}

/**
 * Walk up from startDir looking for .nova/mcp.json (project layer). The walk
 * STOPS at the real home directory: everything above it is not "project"
 * material, and on Windows %TEMP% lives under the profile, so ascending past
 * home would let any run in a temp dir silently adopt the user's global
 * config as a "project" layer. The user-level ~/.nova/mcp.json is applied
 * explicitly by the `homedir` fallback afterwards (injectable so tests stay
 * hermetic). Nothing is ever written to the home directory.
 */
export async function findMcpConfigFile(startDir: string, homedir: string = os.homedir()): Promise<string | undefined> {
  const boundary = path.resolve(os.homedir());
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 32; depth++) {
    if (dir !== boundary) {
      const candidate = mcpConfigPath(dir);
      if (await exists(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const homeCandidate = path.join(homedir, NOVA_DIR, 'mcp.json');
  return (await exists(homeCandidate)) ? homeCandidate : undefined;
}

export interface LoadedMcpConfig {
  file: string;
  servers: McpServerConfig[];
}

/** Load, validate, expand and filter (enabled !== false) the MCP config. */
export async function loadMcpConfig(startDir: string, explicitFile?: string): Promise<LoadedMcpConfig | undefined> {
  const file = explicitFile ?? (await findMcpConfigFile(startDir));
  if (file === undefined) return undefined;
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const expanded = await expandRefsDeep(parsed, path.dirname(file));
  const result = mcpFileSchema.safeParse(expanded);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  mcp.${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`invalid MCP config ${file}:\n${issues}`);
  }
  const servers = Object.entries(result.data.mcp).map(
    ([name, spec]): McpServerConfig => ({ name, ...spec }),
  ).filter((server) => server.enabled !== false);
  return { file, servers };
}

function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

const ENV_REF = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
const FILE_REF = /\{file:([^}]+)\}/g;

/** Expand `{env:NAME}` (unset → empty) and `{file:path}` references. */
export async function expandRefsInPlace(value: string, baseDir: string): Promise<string> {
  let out = value.replace(ENV_REF, (_m, name: string) => process.env[name] ?? '');
  const matches = [...out.matchAll(FILE_REF)];
  if (matches.length > 0) {
    const replacements = await Promise.all(
      matches.map(async (match) => {
        const refPath = path.resolve(baseDir, match[1]!.trim());
        const content = await readFile(refPath, 'utf8').catch(() => undefined);
        return content !== undefined ? content.trim() : '';
      }),
    );
    out = out.replace(FILE_REF, () => replacements.shift() ?? '');
  }
  return out;
}

async function expandRefsDeep(value: unknown, baseDir: string): Promise<unknown> {
  if (typeof value === 'string') return expandRefsInPlace(value, baseDir);
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => expandRefsDeep(item, baseDir)));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    await Promise.all(
      Object.entries(value).map(async ([key, val]) => {
        out[key] = await expandRefsDeep(val, baseDir);
      }),
    );
    return out;
  }
  return value;
}
