#!/usr/bin/env node
/**
 * `nova` — argv in, surface out.
 *
 * This file is deliberately thin: version/help, argv parsing, and surface
 * resolution. The four built-ins (web/repl/exec/qqbot) and every configured
 * surface are the SAME `AgentSurface` type living in ONE registry, registered
 * in precedence order (subcommands → configured → defaults); the shell asks
 * `registry.resolve` once and hands the winner to the ONE assembly
 * (`surface-host.ts`). Adding a surface the shell does not ship is a config
 * row (`~/.nova/config.json` `surfaces`), never a source change here.
 */
import path from 'node:path';
import process from 'node:process';
import type { AgentSurfaceRequest } from '@nova-agent/core';
import { createSurfaceRegistry } from '@nova-agent/plugins';
import { loadConfigWithDiagnostics } from './config.js';
import { builtinSurfaces, loadDynamicSurfaces, parseArgs, reportError } from './surfaces.js';
import { runSurface, toFlags } from './surface-host.js';
import { runPluginCommand } from './plugin-command.js';
import { cliVersion } from './version.js';

const HELP = `nova — 自研本地编码智能体

usage:
  nova [--web|--repl] [--resume <session.jsonl>] [--approval read-only|auto-edit|full] [--theme dark|light|plain]
  nova exec "<task>" [--json] [--approval ...] [--resume <session.jsonl>]

options:
  exec "<task>"   非交互单次执行；--json 以 JSONL 输出事件流（CI 友好）
  qqbot           QQ 机器人模式（需配置 qqbot.appId / qqbot.clientSecret）
  plugin          add <包名> | remove <包名> | list——第三方插件装到 ~/.nova/plugins 并写入 plugins.extra（不经配置加载，配置坏了也能修）
  --web           浏览器界面（本机 HTTP+WS 单进程，打印带 token 的 URL；NOVA_WEB_PORT 固定端口）——交互运行的默认形态
  --repl          改用 readline 终端形态（非 TTY 自动回落）
  --resume        续接历史会话文件
  --approval      临时覆盖审批档位；exec 模式下无法交互确认，未放行的请求会被拒绝
  --theme         临时覆盖界面主题（config 的 ui.theme 是持久设置；NO_COLOR 恒定无色）
  --version/-v    显示版本
  --help/-h       显示本帮助

运行于当前工作目录（即工作区，nova 不会在项目里创建或读取任何文件）；配置唯一
来源是 ~/.nova/config.json（plugins.disable / plugins.extra 可在配置层增删插件）；
会话按日期归档在 ~/.nova/sessions/YYYY/MM/DD/，溢出缓存在 ~/.nova/cache/。
技能按 用户级 → 项目级 两级解析。`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Version/help only match as LEADING flags, so a task string like
  // `nova exec "--version"` is not mistaken for the flag.
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
  // `nova plugin …` runs BEFORE the config is loaded (outside the try below, on
  // purpose): the rows it rewrites are the ones the next boot reads, and a
  // `plugins.extra` row that cannot load is exactly what fails a boot — a repair
  // tool that needs a working config cannot repair a broken one.
  if (parsed.positional[0] === 'plugin') {
    process.exitCode = await runPluginCommand(parsed.positional.slice(1));
    return;
  }
  try {
    const { config, diagnostics } = await loadConfigWithDiagnostics();
    // ONE registry, registered in PRECEDENCE ORDER: the two subcommands, then
    // whatever `~/.nova/config.json` `surfaces` loaded, then the defaults.
    // Resolution is a single `registry.resolve` — the winner is recorded as a
    // side effect (`current()`), which is the ONE source the `userQuestions`
    // provider reads.
    const registry = createSurfaceRegistry();
    const builtins = builtinSurfaces({ config, diagnostics });
    for (const entry of builtins.head) registry.register(entry.surface);
    const rows = await loadDynamicSurfaces(config, process.cwd(), registry);
    for (const entry of builtins.tail) registry.register(entry.surface);

    const rootDir = path.resolve(process.cwd());
    const request: AgentSurfaceRequest = {
      rootDir,
      argv: args,
      interactive: process.stdout.isTTY === true && process.stdin.isTTY === true,
      flags: toFlags(parsed),
    };
    const winner = registry.resolve(request);
    if (winner === undefined) {
      console.error('没有 surface 认领这个调用（--help 查看用法）');
      process.exitCode = 1;
      return;
    }
    if (parsed.json && winner.name !== 'exec') {
      console.error('--json 仅在 exec 模式有效');
      process.exitCode = 1;
      return;
    }
    // Interactive surfaces take stray positionals as noise rather than as a
    // task — flag it so a typo like `nova epwn` does not silently drop intent.
    if (winner.interactive === true && parsed.positional.length > 0) {
      console.error(
        `warning: 交互模式忽略多余位置参数：${parsed.positional.join(' ')}（exec 模式请用 nova exec "<task>"）`,
      );
    }
    // 内置四家的装配前置（boot 贡献）随行；配置的 surface 没有贡献。
    const entry = [...builtins.head, ...builtins.tail].find((builtin) => builtin.surface === winner);
    await runSurface(winner, { rootDir, config, parsed, diagnostics, interactive: request.interactive, surfaces: rows }, args, entry?.boot);
  } catch (err) {
    reportError(err);
  }
}

await main();
