// 包间依赖方向门禁（AGENTS.md §4 的机械化）。
// 违规即失败：core 不得有上游；其余只允许白名单内的下行依赖。
// 白名单是架构事实，改动它=改架构，应在 diff 里显眼地被审阅。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const packagesDir = join(repoRoot, 'packages');

/** 每个包允许直接 import 的下行包（空数组=零上游内核）。
 *
 * 八个包：内核 `core` 与 `plugins`（容器 + 工具 + 内核装配）、`ai`（provider
 * 客户端）、`web`（WebUI surface 后端，含前端子包 `web/ui`）、`qqbot`（渠道
 * 插件示范）、`cli`（surface 装配壳），以及终端 TUI 的两层——`tui`（零依赖
 * 渲染基座：行差分、按键解码、宽度感知换行）与 `tui-app`（TUI surface）。
 * surface = 任何消费内核事件流的进程形态，官方 surface 与第三方同地位、只
 * 依赖 core/plugins 公共 API。
 *
 * `tui` 的白名单是**空**：它不认识内核、不认识插件，只做「字符格 + 按键」，
 * 所以任何包都能依赖它而不引入反向约束。
 */
const ALLOW = {
  core: [],
  tui: [],
  ai: ['core'],
  plugins: ['core'],
  qqbot: ['core', 'plugins'],
  web: ['core', 'plugins'],
  'tui-app': ['tui', 'core', 'plugins'],
  // cli assembles surfaces but imports NONE of them: web/repl/exec/qqbot are
  // built-in (inseparable from the argv grammar / exec stream / bot channel),
  // while the terminal UI and any third-party surface are loaded DYNAMICALLY
  // from `~/.nova/config.json` `surfaces` (`loadSurfacePlugins`). Dropping
  // `tui`/`tui-app` here makes that machine-proven: the cli source cannot
  // reference the TUI package even in a string literal, so a surface is a
  // config row, not a hardcoded dependency.
  cli: ['plugins', 'ai', 'core', 'qqbot', 'web'],
};

/** 递归收集 .ts / .tsx 源文件（前端子包是 .tsx）。 */
function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * 一个包要扫的全部 `src/` 目录：自身，加上**嵌套工作区成员**的 `src/`。
 *
 * 原先只扫 `packages/<pkg>/src`，于是 `packages/web/ui/src`（前端子包
 * `nova-web-ui`，全仓最大的一块代码）从未被检查过——它 import 什么都不会失败。
 * 嵌套成员归**宿主包**的白名单管：`web/ui` 按 `web` 的规则（core / plugins）。
 * @param pkg - 包目录名。
 * @returns 该包名下的 `src` 目录列表。
 */
function srcDirsOf(pkg) {
  const out = [join(packagesDir, pkg, 'src')];
  let subs;
  try {
    subs = readdirSync(join(packagesDir, pkg));
  } catch {
    return out;
  }
  for (const sub of subs) out.push(join(packagesDir, pkg, sub, 'src'));
  return out.filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

const IMPORT_RE = /@nova-agent\/([a-z-]+)/g;
const violations = [];

for (const [pkg, allowed] of Object.entries(ALLOW)) {
  const files = [];
  for (const dir of srcDirsOf(pkg)) {
    try {
      files.push(...sources(dir));
    } catch {
      /* no src/ here */
    }
  }
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    for (const [, target] of text.matchAll(IMPORT_RE)) {
      if (!(target in ALLOW)) {
        violations.push(`${rel}: 未知包 @nova-agent/${target}`);
      } else if (!allowed.includes(target) && target !== pkg) {
        violations.push(`${rel}: @nova-agent/${pkg} → @nova-agent/${target} 不在白名单`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('✗ 依赖方向违规：');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`✓ 依赖方向：${Object.keys(ALLOW).length} 个包全部符合 AGENTS.md §4 白名单`);
