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
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSources, filterArgs, workspaceLeafDirs } from './gates-lib.mjs';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const budgetPath = join(repoRoot, 'scripts', 'structure-budget.json');

/**
 * 纯转出桶（barrel）？——只有注释、空行与 `export *` / `export { … } from` 的文件。
 *
 * 这类文件的行数就是**模块条数**，不是设计属性：每加一个模块必然 +1 行，而
 * 「拆它」在这里没有任何含义（一个桶拆成两个桶只会多一个桶）。把上限用在它身上
 * 是纯粹的假阳性——它逼人为了过门禁去动一个本来正确的文件。
 *
 * 判据刻意收得很紧：只要出现任何函数、类型、常量声明就不再算桶，因此它不能用来
 * 把真正的实现文件洗白。用一个具名文件（`export const x = …` 也排除）即是实现。
 * @param source - 文件全文。
 * @returns 是否是一个纯转出桶。
 */
function isBarrel(source) {
  const lines = source.split('\n');
  let sawExport = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('*/')) continue;
    // 只承认 `export * from '…'`、`export { … } from '…'` 与 `export type { … } from '…'`
    // （可跨行，故按起始片段判）。`export type { … } from` 同样是再导出：它不含任何
    // 声明，却曾因为多了一个 `type` 就让整个桶失去豁免，把模块条数当成设计属性来收税。
    if (/^export\s+\*\s+from\s+['"]/.test(line)) { sawExport = true; continue; }
    if (/^export\s*\{/.test(line)) { sawExport = true; continue; }
    if (/^export\s+type\s*\{/.test(line)) { sawExport = true; continue; }
    // `export {` 的续行与收尾：`} from '…';` 或单纯的 `};`
    if (sawExport && /^(\w+\s*,?\s*)*\}?\s*(from\s+['"][^'"]*['"])?;?$/.test(line)) continue;
    return false;
  }
  return sawExport;
}

const packagesDir = join(repoRoot, 'packages');
const current = {};
for (const srcDir of workspaceLeafDirs(packagesDir, 'src')) {
  for (const f of collectSources(srcDir)) {
    const rel = relative(repoRoot, f).replace(/\\/g, '/');
    const source = readFileSync(f, 'utf8');
    // A pure re-export barrel is exempt: its length is a module COUNT, not a
    // design property, so a ceiling here is a false positive with no meaningful
    // fix. Everything else is measured as before.
    if (isBarrel(source)) continue;
    current[rel] = source.split('\n').length;
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
  const filters = filterArgs(process.argv.slice(2));
  const next = { ...baseline };
  let lowered = 0;
  let raised = 0;
  let added = 0;
  let untouched = 0;
  /**
   * 上限 = 当前行数 + 余量，而不是当前行数。
   *
   * 这是这套门禁曾经失效的根因：`--update` 把上限钉死为**当下行数**，于是每个文件
   * 一落地就处在 100%，任何一次「再多写一行」都立刻红。代价是三重的：
   *
   *  - 门禁只会说「你已经撞墙了」，永远说不出「你快撞墙了」——没有预警，只有事后
   *    追认。作者在写代码时得不到任何反馈，只能在收尾时被一次性告知二十个文件全超；
   *  - 于是每次都要停下来做**大批返工**（拆文件），而这本可以在写的时候就顺手做；
   *  - 「逼近上限」这个提示彻底失去意义（所有文件都报 100%）。
   *
   * 留出余量之后，含义变成「自上次同步以来这个文件长大了 X%」——那才是真正值得
   * 注意的信号，也是作者在写代码的当下能看见的信号。
   */
  const HEADROOM = 1.1;
  const headroomOf = (lines) => Math.max(lines + 10, Math.ceil(lines * HEADROOM));
  for (const [file, lines] of Object.entries(current)) {
    const match = filters.length === 0 || filters.some((s) => file.includes(s));
    if (!match) continue;
    const old = next[file];
    /**
     * The ceiling TRACKS the file: always `headroomOf(lines)`, never a high-water
     * mark.
     *
     * It used to be `Math.max(candidate, Math.min(old, headroomOf(old)))`, which
     * reads like a guard against dropping below the old value but is provably a
     * no-op: `headroomOf(old) >= old` always, so `Math.min(old, headroomOf(old))`
     * is always `old`, leaving `max(candidate, old)` — **the ceiling could only
     * stay or rise**, and the script's own `lowered` counter (and the "下调静默"
     * note in AGENTS.md) described a branch that could never run.
     *
     * That mattered in practice: a file written to a bloated intermediate state
     * during a refactor, followed by ANY unfiltered `gates:update`, baked the bloat
     * into its ceiling permanently. A later author could then grow the file back
     * into that headroom with the gate staying silent — the excess became
     * invisible instead of being an instruction to split.
     *
     * Tracking the file keeps the number HONEST: headroom stays proportional, a
     * shrink tightens the ceiling, and growth is always printed as RAISED so the
     * diff shows it.
     */
    next[file] = headroomOf(lines);
    if (old === undefined) added++;
    else if (next[file] > old) {
      raised++;
      console.log(`  (RAISED) ${file}: ${old} → ${next[file]}`);
    } else if (next[file] < old) {
      lowered++;
      console.log(`  (lowered) ${file}: ${old} → ${next[file]}`);
    }
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
/**
 * 逼近上限 = 剩余 **绝对** 行数已经很少。
 *
 * 刻意不用百分比：上限由 `--update` 授予固定余量（≥10 行或 ≥10%），所以同步刚结束时
 * 「剩余/上限」恒在 91% 左右——用百分比判定会把每个文件都报成「逼近」，那不是信号，
 * 是噪音（本文件上一版正是如此，一口气打印了 97 行）。
 *
 * 绝对阈值则是精确的：同步刚结束不可能触发（余量至少 10 行），只有某个文件在两次同步
 * 之间真的长到快顶上时才会出现。那正是「下次再加代码就会红」的时刻。
 */
const TIGHT_LINES = 10;
const nearLimit = [];
for (const [file, lines] of Object.entries(current)) {
  const ceiling = baseline[file];
  if (ceiling === undefined) failures.push(`${file}: ${lines} 行，无上限条目（新文件——跑 pnpm gates:update）`);
  else if (lines > ceiling) {
    failures.push(`${file}: ${lines} 行 > 上限 ${ceiling}（超 ${lines - ceiling} 行）——按职责拆分；确有理由才用 --update <子串> 显式放宽`);
  } else if (ceiling - lines < TIGHT_LINES) {
    nearLimit.push(`  · ${file}: ${lines}/${ceiling}（只剩 ${ceiling - lines} 行）`);
  }
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
// 这是**前瞻**信息，不是失败：它出现在每一次运行里（含 `pnpm check` 的快环），让
// 「这个文件快装不下了」在写代码的当下就可见，而不是等一批文件一起爆掉才发现。
if (nearLimit.length > 0) {
  console.log(`\n⚠ ${nearLimit.length} 个文件快顶上上限了——下次再加代码就会红，建议现在就按职责拆：`);
  for (const line of nearLimit) console.log(line);
}
