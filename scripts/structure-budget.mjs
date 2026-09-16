// 单文件行数棘轮（AGENTS.md「避免单文件超长」的机械化）。
// 语义：每包 src 文件有一个行数预算，只降不升——
//   超预算 → 失败（要么拆分，要么这次就不该写这么多）；
//   低于预算 → 通过但提示（趁热跑 --update 把棘轮拧下去，diff 即重构进度证据）；
//   新文件 → 失败并要求 --update（新文件入账必须在 diff 里可见）。
// --update 从不调高任何既有预算（防「重构失败就放宽基线」的自欺）。
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const budgetPath = join(repoRoot, 'scripts', 'structure-budget.json');
const update = process.argv.includes('--update');

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
  let files = [];
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
  if (!update) {
    console.error('✗ 缺 scripts/structure-budget.json —— 先跑 --update 生成基线');
    process.exit(1);
  }
}

if (update) {
  const next = {};
  let raised = 0;
  for (const [file, lines] of Object.entries(current)) {
    const old = baseline[file];
    next[file] = old === undefined ? lines : Math.min(old, lines);
    if (old !== undefined && old < lines) raised++;
  }
  writeFileSync(budgetPath, JSON.stringify(next, null, 1) + '\n');
  const lowered = Object.keys(next).filter((f) => baseline[f] !== undefined && next[f] < baseline[f]).length;
  const added = Object.keys(next).filter((f) => baseline[f] === undefined).length;
  console.log(
    `✓ 预算已更新：下调 ${lowered} 个、新增 ${added} 个、封顶（文件超旧预算、保持旧值）${raised} 个——封顶文件请跑 check 查看`
  );
  process.exit(0);
}

const failures = [];
const stale = [];
const shrinkable = [];
for (const [file, lines] of Object.entries(current)) {
  const budget = baseline[file];
  if (budget === undefined) failures.push(`${file}: ${lines} 行，无预算条目（新文件——跑 --update 入账）`);
  else if (lines > budget) failures.push(`${file}: ${lines} 行 > 预算 ${budget} 行——拆分它，别放宽基线`);
  else if (lines < budget) shrinkable.push(`${file}: ${lines} < 预算 ${budget}（可下调）`);
}
for (const file of Object.keys(baseline)) {
  if (current[file] === undefined) stale.push(`${file}: 预算条目对应文件已不存在`);
}

if (failures.length > 0 || stale.length > 0) {
  for (const f of failures) console.error('✗ ' + f);
  for (const s of stale) console.error('✗ ' + s);
  process.exit(1);
}
if (shrinkable.length > 0) {
  console.log(`⚠ ${shrinkable.length} 个文件低于预算（趁重构收尾跑 pnpm gates:update 拧棘轮）`);
}
console.log(`✓ 行数棘轮：${Object.keys(current).length} 个 src 文件全部守住预算`);
