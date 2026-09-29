#!/usr/bin/env node
/**
 * `nova` — argv in, surface out.
 *
 * This file is deliberately thin: version/help, argv parsing and surface
 * resolution. Built-in surfaces (web/repl/exec/qqbot) live in `surfaces.ts`;
 * every OTHER surface — the terminal UI included — is a plugin loaded from
 * `~/.nova/config.json` `surfaces` via `loadDynamicSurfaces`, so adding a
 * surface is a config row, not a source change here.
 */
import { createSurfaceRegistry } from '@nova-agent/plugins';
import { loadConfigWithDiagnostics } from './config.js';
import { loadDynamicSurfaces, parseArgs, reportError, resolveSurface, surfaceRequest } from './surfaces.js';
import { cliVersion } from './version.js';

const HELP = `nova — 自研本地编码智能体

usage:
  nova [--tui|--web|--repl] [--resume <session.jsonl>] [--approval read-only|auto-edit|full] [--theme dark|light|plain]
  nova exec "<task>" [--json] [--approval ...] [--resume <session.jsonl>]

options:
  exec "<task>"   非交互单次执行；--json 以 JSONL 输出事件流（CI 友好）
  qqbot           QQ 机器人模式（需配置 qqbot.appId / qqbot.clientSecret）
  --tui           终端全屏界面（需 stdin/stdout 都是 TTY；管道下回落 --repl）
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
  try {
    const { config, diagnostics } = await loadConfigWithDiagnostics();
    // Surface plugins are resolved BEFORE the kernel exists — the chosen
    // surface declares whether it answers questions, which the assembly reads.
    // Configured surfaces sit between the subcommands and the defaults.
    const registry = createSurfaceRegistry();
    const { entries: extras, rows } = await loadDynamicSurfaces(config, process.cwd(), args, registry);
    const request = surfaceRequest(process.cwd(), config, parsed, diagnostics, rows);
    const resolved = resolveSurface(request, extras);
    if (resolved === undefined) {
      console.error('没有 surface 认领这个调用（--help 查看用法）');
      process.exitCode = 1;
      return;
    }
    if (parsed.json && resolved.name !== 'exec') {
      console.error('--json 仅在 exec 模式有效');
      process.exitCode = 1;
      return;
    }
    // `--tui` is an explicit opt-in: if no configured surface named "tui" claimed
    // it, the request fell through to the browser default — that is a surprise,
    // not a sensible fallback. Point at the config row that would fix it.
    if (parsed.tui && !parsed.repl && resolved.name !== 'tui') {
      console.error(
        '--tui 需在 ~/.nova/config.json 的 surfaces 里声明终端界面插件（tui-app 包的 ./surface 子路径）',
      );
      process.exitCode = 1;
      return;
    }
    // Interactive surfaces take stray positionals as noise rather than as a
    // task — flag it so a typo like `nova epwn` does not silently drop intent.
    if (resolved.interactive === true && parsed.positional.length > 0) {
      console.error(
        `warning: 交互模式忽略多余位置参数：${parsed.positional.join(' ')}（exec 模式请用 nova exec "<task>"）`,
      );
    }
    await resolved.start(request);
  } catch (err) {
    reportError(err);
  }
}

await main();