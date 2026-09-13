#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from './config.js';
import { startRepl } from './repl.js';
import { cliVersion } from './version.js';

const HELP = `nova — 自研本地编码智能体

usage:
  nova [--repl] [--resume <session.jsonl>] [--approval read-only|auto-edit|full]
  nova exec "<task>" [--json] [--approval ...] [--resume <session.jsonl>]

options:
  exec "<task>"   非交互单次执行；--json 以 JSONL 输出事件流（CI 友好）
  qqbot           QQ 机器人模式（需配置 qqbot.appId / qqbot.clientSecret）
  --repl          强制使用 readline REPL（默认 TTY 下进全屏 TUI）
  --resume        续接历史会话文件
  --approval      临时覆盖审批档位；exec 模式下无法交互确认，未放行的请求会被拒绝
  --version/-v    显示版本
  --help/-h       显示本帮助

运行于当前工作目录（即工作区，nova 不会在项目里创建或读取任何文件）；配置唯一
来源是 ~/.nova/config.json；会话按日期归档在 ~/.nova/sessions/YYYY/MM/DD/，
溢出缓存在 ~/.nova/cache/。技能按 用户级 → 项目级 两级解析。`;

interface ParsedArgs {
  resumeFile?: string;
  approvalOverride?: 'read-only' | 'auto-edit' | 'full';
  json: boolean;
  repl: boolean;
  positional: string[];
}

function parseArgs(args: string[]): ParsedArgs | undefined {
  const parsed: ParsedArgs = { json: false, repl: false, positional: [] };
  // Everything after a bare `--` is positional verbatim, so a task starting
  // with '-' (nova exec -- "-check the config") is passed through untouched.
  let positionalOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!positionalOnly && arg === '--') {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && arg === '--resume') {
      const value = args[++i];
      if (!value) {
        console.error('--resume requires a session file path');
        process.exitCode = 1;
        return undefined;
      }
      parsed.resumeFile = value;
    } else if (arg === '--approval') {
      const value = args[++i];
      if (value !== 'read-only' && value !== 'auto-edit' && value !== 'full') {
        console.error('--approval must be one of: read-only, auto-edit, full');
        process.exitCode = 1;
        return undefined;
      }
      parsed.approvalOverride = value;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--repl') {
      parsed.repl = true;
    } else if (!positionalOnly && arg.startsWith('-')) {
      console.error(`unknown option: ${arg}（--help 查看用法）`);
      process.exitCode = 1;
      return undefined;
    } else {
      parsed.positional.push(arg);
    }
  }
  return parsed;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Version/help only match as LEADING flags so a task string like
  // nova exec "--version" is not mistaken for the flag.
  const first = args[0];
  if (first === '--version' || first === '-v') {
    console.log(`nova ${cliVersion()}`);
    return;
  }
  if (first === '--help' || first === '-h') {
    console.log(HELP);
    return;
  }
  const parsed = parseArgs(args);
  if (parsed === undefined) return;
  const execMode = parsed.positional[0] === 'exec';
  const qqbotMode = parsed.positional[0] === 'qqbot';
  const taskParts = execMode ? parsed.positional.slice(1) : parsed.positional;

  const rootDir = path.resolve(process.cwd());
  try {
    const config = await loadConfig();
    if (qqbotMode) {
      const { startQqBot } = await import('./qqbot-mode.js');
      await startQqBot({ rootDir, config });
      return;
    }
    if (execMode) {
      let prompt = taskParts.join(' ').trim();
      if (prompt.length === 0 && process.stdin.isTTY !== true) {
        prompt = (await readStdin()).trim();
      }
      if (prompt.length === 0) {
        console.error('usage: nova exec "<task>"（或通过管道传入任务文本）');
        process.exitCode = 1;
        return;
      }
      const { runExec } = await import('./exec.js');
      await runExec({
        rootDir,
        config,
        prompt,
        json: parsed.json,
        ...(parsed.resumeFile !== undefined ? { resumeFile: parsed.resumeFile } : {}),
        ...(parsed.approvalOverride !== undefined ? { approvalOverride: parsed.approvalOverride } : {}),
      });
      return;
    }
    if (parsed.json) {
      console.error('--json 仅在 exec 模式有效');
      process.exitCode = 1;
      return;
    }
    // Interactive mode ignores stray positionals (exec handles its own), but
    // flag them so a typo like `nova epwn` does not silently drop the intent.
    if (parsed.positional.length > 0) {
      console.error(`warning: 交互模式忽略多余位置参数：${parsed.positional.join(' ')}（exec 模式请用 nova exec "<task>"）`);
    }
    const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
    if (interactive && !parsed.repl) {
      const { startTui } = await import('./tui-mode.js');
      await startTui({
        rootDir,
        config,
        ...(parsed.resumeFile !== undefined ? { resumeFile: parsed.resumeFile } : {}),
        ...(parsed.approvalOverride !== undefined ? { approvalOverride: parsed.approvalOverride } : {}),
      });
    } else {
      await startRepl({
        rootDir,
        config,
        ...(parsed.resumeFile !== undefined ? { resumeFile: parsed.resumeFile } : {}),
        ...(parsed.approvalOverride !== undefined ? { approvalOverride: parsed.approvalOverride } : {}),
      });
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

await main();
