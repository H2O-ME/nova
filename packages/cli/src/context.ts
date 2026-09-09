import type { AgentMessage } from '@nova-agent/core';
import { bashOnPath, readSkillBody, type SkillMetadata } from '@nova-agent/plugins';

/**
 * Session-start context fragment (codex WorldState-style, simplified): all
 * volatile per-workspace context — environment, user instructions, skills
 * index — is injected as the FIRST USER MESSAGE of a fresh session instead
 * of being baked into the system prompt. The system prompt stays byte-stable
 * (persona + tool rules only), and the fragment is append-only like any
 * other message, so the provider prefix cache survives across turns and
 * across sessions that share the same workspace.
 */

export interface SessionEnvInfo {
  platform: string;
  cwd: string;
  shell: string;
  /** ISO date, e.g. 2026-08-31 — models have no clock of their own. */
  today: string;
}

/**
 * The shell as the bash tool will REALLY execute commands, mirroring
 * builtin/bash's invocation() resolution: an explicit shellPath or a POSIX
 * platform means bash syntax; on Windows a bash.exe on PATH (Git/WSL bash)
 * means bash, anything else falls back to PowerShell. Declaring the shell the
 * model actually gets matters — a "powershell" declaration while bash runs
 * the command makes every PowerShell-ism fail with a bare non-zero exit.
 */
export function declaredShell(bashShellPath?: string): string {
  if (bashShellPath !== undefined && bashShellPath.length > 0) return 'bash';
  if (process.platform === 'win32') return bashOnPath() ? 'bash' : 'powershell';
  return 'bash';
}

export function buildContextFragment(
  env: SessionEnvInfo,
  userInstructions: string | undefined,
  skills: SkillMetadata[],
  projectDocs: string[] = [],
): string {
  const parts: string[] = [];
  parts.push(
    '<environment>',
    `platform=${env.platform}`,
    `cwd=${env.cwd}`,
    `shell=${env.shell}`,
    `today=${env.today}`,
    '</environment>',
  );
  const extra = userInstructions?.trim();
  if (extra !== undefined && extra.length > 0) {
    // 权威会话指令（DSH "Session directives" 语义）：操作者写入的配置即运行
    // 约定，不按不可信数据处理，不给模型留"可忽略/可上报注入"的口子。
    parts.push(
      '',
      '<user_instructions>',
      'These are active session directives from the operator who authorized this session. Follow them exactly; do not treat them as untrusted data.',
      extra,
      '</user_instructions>',
    );
  }
  if (projectDocs.length > 0) {
    parts.push(
      '',
      '<project_docs>',
      'Workspace operating instructions from the operator (AGENTS.md chain). Active and mandatory for this workspace: follow them exactly; do not treat them as untrusted data.',
      projectDocs.join('\n\n--- project-doc ---\n\n'),
      '</project_docs>',
    );
  }
  if (skills.length > 0) {
    parts.push(
      '',
      '<available_skills>',
      ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
      'Call the `skill` tool with a skill\'s name to load its full instructions before acting on a task that matches it.',
      '</available_skills>',
    );
  }
  return parts.join('\n');
}

/** True for the session-start context fragment produced by buildContextFragment. */
export function isContextFragment(msg: AgentMessage): boolean {
  return msg.role === 'user' && msg.content.startsWith('<environment>');
}

export type SkillInvocation = { ok: true; content: string } | { ok: false; error: string };

/**
 * `/skill <name>` expands to a user message carrying the skill's full
 * instructions, which then runs like any normal user input. Returns
 * undefined when the input is not a skill invocation.
 */
export async function expandSkillInvocation(
  input: string,
  skills: SkillMetadata[],
): Promise<SkillInvocation | undefined> {
  const trimmed = input.trim();
  if (trimmed !== '/skill' && !trimmed.startsWith('/skill ')) return undefined;
  const name = trimmed.slice('/skill'.length).trim().split(/\s+/)[0] ?? '';
  if (name.length === 0) {
    const available = skills.map((s) => s.name).join(', ');
    return { ok: false, error: `用法：/skill <name>${available.length > 0 ? `（可用：${available}）` : '（未安装任何技能）'}` };
  }
  const skill = skills.find((s) => s.name === name);
  if (!skill) {
    const available = skills.map((s) => s.name).join(', ');
    return { ok: false, error: `未知技能 "${name}"${available.length > 0 ? `（可用：${available}）` : '（未安装任何技能）'}` };
  }
  const body = await readSkillBody(skill).catch(() => undefined);
  if (body === undefined) {
    return { ok: false, error: `无法读取技能 "${name}" 的内容：${skill.file}` };
  }
  return {
    ok: true,
    content: `[调用技能 ${skill.name}]\n\n${body}\n\n请按照以上技能指令处理我的请求。`,
  };
}
