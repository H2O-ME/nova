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
 * 六个包：内核 `core` 与 `plugins`（容器 + 工具 + 内核装配）、`ai`（provider
 * 客户端）、`web`（WebUI surface 后端，含前端子包 `web/ui`）、`qqbot`（渠道
 * 插件示范）、`cli`（surface 装配壳）。surface = 任何消费内核事件流的进程形态，
 * 官方 surface 与第三方同地位、只依赖 core/plugins 公共 API。
 */
const ALLOW = {
  core: [],
  ai: ['core'],
  plugins: ['core'],
  qqbot: ['core', 'plugins'],
  web: ['core', 'plugins'],
  cli: ['plugins', 'ai', 'core', 'qqbot', 'web'],
};

/** 递归收集 .ts 源文件。 */
function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /@nova-agent\/([a-z-]+)/g;
const violations = [];

for (const [pkg, allowed] of Object.entries(ALLOW)) {
  const srcDir = join(packagesDir, pkg, 'src');
  let files;
  try {
    files = sources(srcDir);
  } catch {
    continue; // 包无 src（不应发生），跳过
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
