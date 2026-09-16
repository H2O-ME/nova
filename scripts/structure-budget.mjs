// 单文件行数预算（AGENTS.md「避免单文件超长」的机械护栏）。
//
// 语义：scripts/structure-budget.json 给每个 src 文件钉一个行数上限（ceiling）。
//   check（默认）：任一文件超上限即失败；新文件无上限条目也失败（须入账）。
//   --update [子串...]：把上限同步为当前行数。传子串则只同步路径含该子串的文件，
//     否则同步全部——但**任何上调都会逐条打印 (RAISED)**，让「放宽上限」成为
//     一次显式、diff 可见的动作，而不是随手绕过。
//
// 定位：这是「粗护栏」——真正治巨型闭包的是 oxlint 的 max-lines-per-function/
// complexity 警告（拆壳阶段的靶单）。行数上限只兜底「文件整体别再无节制地长」，
// 所以刻意做得低摩擦：正常消重使某文件 ±1 行时，跑一次 --update <该文件> 即可。
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const budgetPath = join(repoRoot, 'scripts', 'structure-budget.json');

/** 递归收集包 src 下全部 .ts。 */
function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const packagesDir = join(repoRoot, 'packages');
const current = {};
for (const pkg of readdirSync(packagesDir)) {
  const srcDir = join(packagesDir, pkg, 'src');
  let files;
  try {
    files = sources(srcDir);
  } catch {
    continue;
  }
  for (const f of files) {
    const rel = relative(repoRoot, f).replace(/\\/g, '/');
    current[rel] = readFileSync(f, 'utf8').split('\n').length;
  }
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(budgetPath, 'utf8'));
} catch {
  if (!process.argv.includes('--update')) {
    console.error('✗ 缺 scripts/structure-budget.json —— 先跑 --update 生成基线');
    process.exit(1);
  }
}

if (process.argv.includes('--update')) {
  const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const next = { ...baseline };
  let lowered = 0;
  let raised = 0;
  let added = 0;
  let untouched = 0;
  for (const [file, lines] of Object.entries(current)) {
    const match = filters.length === 0 || filters.some((s) => file.includes(s));
    if (!match) continue;
    const old = next[file];
    next[file] = lines;
    if (old === undefined) added++;
    else if (lines > old) {
      raised++;
      console.log(`  (RAISED) ${file}: ${old} → ${lines} (+${lines - old})`);
    } else if (lines < old) lowered++;
  }
  const stale = Object.keys(next).filter((f) => current[f] === undefined);
  for (const f of stale) delete next[f];
  writeFileSync(budgetPath, JSON.stringify(next, null, 1) + '\n');
  const sorted = {};
  for (const f of Object.keys(next).sort()) sorted[f] = next[f];
  writeFileSync(budgetPath, JSON.stringify(sorted, null, 1) + '\n');
  console.log(
    `✓ 预算已同步：下调 ${lowered}、上调 ${raised}、新增 ${added}、移除陈旧 ${stale.length}、未触及 ${untouched}（共 ${Object.keys(current).length} 文件）`
  );
  if (raised > 0) console.log('⚠ 有上限被上调——确认这次增长是有意的，commit diff 会显眼地带上它。');
  process.exit(0);
}

const failures = [];
const stale = [];
for (const [file, lines] of Object.entries(current)) {
  const ceiling = baseline[file];
  if (ceiling === undefined) failures.push(`${file}: ${lines} 行，无上限条目（新文件——跑 pnpm gates:update）`);
  else if (lines > ceiling) failures.push(`${file}: ${lines} 行 > 上限 ${ceiling}——拆分它，或 --update 显式放宽`);
}
for (const file of Object.keys(baseline)) {
  if (current[file] === undefined) stale.push(`${file}: 上限条目对应文件已不存在（跑 --update 清理）`);
}
if (failures.length > 0 || stale.length > 0) {
  for (const f of failures) console.error('✗ ' + f);
  for (const s of stale) console.error('✗ ' + s);
  process.exit(1);
}
console.log(`✓ 行数预算：${Object.keys(current).length} 个 src 文件全部在上限内`);
