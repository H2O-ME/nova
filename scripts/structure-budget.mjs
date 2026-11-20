// 单文件行数上限（AGENTS.md「避免单文件超长」的机械护栏）。
//
// 语义：**扁平阈值 + 少量豁免**，不维护逐文件登记册。
//   check（默认）：任一文件超过 `ceiling` 且不在豁免表里即失败。
//   --update：把豁免表同步为「当前仍超阈值的文件」，并顺带清理已删除/已缩回的条目。
//
// 为什么不是「每个文件钉一个上限」
// ---------------------------------
// 上一版给 scripts/structure-budget.json 里每个 src 文件单独钉一个 ceiling，于是：
//
//  1. **新增文件必须先登记**才算过门禁——这与「别写巨型文件」毫无关系，纯粹是账本
//     维护。作者为了一个 40 行的纯函数新文件就得跑一次同步脚本。
//  2. ceiling = 当前行数 + 余量，意味着文件**一落地就处在 ~91%**，此后每次加代码
//     都会红。这不是护栏，是每写一行就敲一次钟。
//  3. 于是「过门禁」的正确做法变成了**按行数配平而拆文件**——拆出的模块只为凑数，
//     不承担任何职责边界。过度拆分就是这么被机械地逼出来的。
//  4. 账本还有第三种腐烂方式：文件被删（包迁出）后条目仍在，check 把「陈旧条目」
//     也算失败。qqbot 迁出本仓后，283 条陈尸条目让 `pnpm gates` 长期为红——而它与
//     任何人的改动都无关。
//
// 一个扁平阈值同时解决这四件事：低于阈值的文件**完全无需关心**，新增文件**无需登记**，
// 删文件**不会留下负债**。豁免表只装「本来就在阈值之上」的存量文件，并且只许缩、不许涨
// （涨了要显式 --update，diff 里看得见）。
//
// 阈值取 600 行：本仓 src 的行数 p99 是 635、中位数 111，600 只圈住 4 个真正的存量巨物，
// 而 96% 的文件一辈子碰不到它。护栏仍拦得住「无节制长成 2000 行」，
// 但不再参与「要不要拆文件」这个只有作者能判断的决定。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSources, workspaceLeafDirs } from './gates-lib.mjs';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const budgetPath = join(repoRoot, 'scripts', 'structure-budget.json');

/** 硬阈值：低于它完全自由，高于它必须入豁免表。 */
const CEILING = 600;

const packagesDir = join(repoRoot, 'packages');
const current = {};
for (const srcDir of workspaceLeafDirs(packagesDir, 'src')) {
  for (const f of collectSources(srcDir)) {
    const rel = relative(repoRoot, f).replace(/\\/g, '/');
    current[rel] = readFileSync(f, 'utf8').split('\n').length;
  }
}

/** `{ ceiling, grandfathered: { <path>: <lines when grandfathered> } }` */
let baseline = { ceiling: CEILING, grandfathered: {} };
try {
  const parsed = JSON.parse(readFileSync(budgetPath, 'utf8'));
  // 容忍旧格式的存在：旧的扁平 `{ path: lines }` 表一律视为豁免表，阈值用默认值。
  // 这样这次机制替换本身不需要一次性的数据迁移步骤。
  if (parsed.grandfathered === undefined) {
    baseline = { ceiling: parsed.ceiling ?? CEILING, grandfathered: parsed };
  } else {
    baseline = { ceiling: parsed.ceiling ?? CEILING, grandfathered: parsed.grandfathered ?? {} };
  }
} catch {
  if (!process.argv.includes('--update')) {
    console.error('✗ 缺 scripts/structure-budget.json —— 先跑 pnpm gates:update');
    process.exit(1);
  }
}

const ceiling = baseline.ceiling;
const grandfathered = baseline.grandfathered;

if (process.argv.includes('--update')) {
  const next = {};
  let added = 0;
  let raised = 0;
  let lowered = 0;
  for (const [file, lines] of Object.entries(current)) {
    if (lines <= ceiling) continue;
    next[file] = lines;
    const was = grandfathered[file];
    if (was === undefined) {
      added++;
      console.log(`  (NEW) ${file}: ${lines} 行，已入豁免表`);
    } else if (lines > was) {
      raised++;
      console.log(`  (RAISED) ${file}: ${was} → ${lines}`);
    } else if (lines < was) {
      lowered++;
    }
  }
  const dropped = Object.keys(grandfathered).filter((f) => next[f] === undefined);
  const sorted = {};
  for (const f of Object.keys(next).sort()) sorted[f] = next[f];
  writeFileSync(budgetPath, JSON.stringify({ ceiling, grandfathered: sorted }, null, 1) + '\n');
  console.log(
    `✓ 行数预算已同步：新增 ${added}、上调 ${raised}、下调 ${lowered}、移出豁免 ${dropped.length}（阈值 ${ceiling} 行）`
  );
  if (raised > 0) console.log('⚠ 有豁免文件变长——确认这次增长是有意的，commit diff 会带上它。');
  process.exit(0);
}

const failures = [];
for (const [file, lines] of Object.entries(current)) {
  const was = grandfathered[file];
  if (was === undefined) {
    if (lines > ceiling) {
      failures.push(`${file}: ${lines} 行 > 阈值 ${ceiling} —— 按职责拆分，或确有理由时 pnpm gates:update 入豁免表`);
    }
    continue;
  }
  // 已入豁免的文件只能缩不能涨：涨了说明它又长了，要显式承认。
  if (lines > was) {
    failures.push(`${file}: ${lines} 行 > 豁免上限 ${was}（又在变长）—— 拆分，或 pnpm gates:update 显式承认`);
  }
}

// 陈旧/可清理的豁免条目只是**提示**，不是失败：文件被删（包迁出）与文件缩回阈值内
// 都是正常的仓库演化，不该把任何人拦在门禁外面。上一版正是把「陈旧条目」算作失败，
// 让一批与本人改动无关的迁出遗留把 gates 长期钉成红色。
const notes = [];
for (const [file, was] of Object.entries(grandfathered)) {
  const lines = current[file];
  if (lines === undefined) notes.push(`  · ${file}: 文件已不存在（pnpm gates:update 可清理）`);
  else if (lines <= ceiling) notes.push(`  · ${file}: 已缩回阈值内（${lines}/${was}，pnpm gates:update 可移出）`);
}

if (failures.length > 0) {
  console.error('✗ 行数预算超限：');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
const exempt = Object.keys(grandfathered).length;
console.log(
  `✓ 行数预算：${Object.keys(current).length} 个 src 文件均 ≤ ${ceiling} 行` +
    (exempt > 0 ? `（另有 ${exempt} 个存量文件在豁免表）` : '')
);
if (notes.length > 0) {
  console.log(`\n⚠ 豁免表有 ${notes.length} 条可清理（不是失败）：`);
  for (const line of notes) console.log(line);
}
