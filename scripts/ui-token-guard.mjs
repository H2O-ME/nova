// UI token 纪律门禁（packages/web/ui/DESIGN.md §5「守卫规则」）。
//
// 量的是**债务**，不是"这个 CSS 写得漂不漂亮"：组件 sheet 里不得出现
// spacing / radius / shadow / duration / ease 的字面量。
//
// 允许的字面值是**封闭清单**（§5.2）：border-width、hairline 1px、icon size、
// SVG 绘制尺寸、特殊图形几何。五条规则的属性清单刻意不含这些——所以
// `border: 1px solid …`、`stroke-width: 1.5`、`width: 16px` 都不会被计。
//
// 为什么是「全仓每条规则一个总数」，不是「每个 sheet 每个规则一个计数」
// ---------------------------------------------------------------------
// 上一版给每个 sheet 的每条规则各钉一个数（75 条记录），于是**新建任何一个 sheet，
// 只要写了 1 个 px，门禁立刻红**，哪怕全仓债务毫无变化。作者的应对只能是跑
// `--update` 把新数字记进去——一次纯记账动作，与设计系统是否被遵守无关。
// 那套登记册最终衡量的不是「债务有多少」，而是「账本有没有跟上」。
//
// 现在只记**每条规则的全仓总数**，并留出余量：日常改动（新增一个 sheet 用掉几个
// 字面量）落在余量里，门禁不吭声；只有整仓债务真的系统性上涨时才红。于是
// 「新增文件要登记」这件事彻底消失，而「别让字面量蔓延」这个信号仍然在。
//
// 语义：
//   check（默认）：任一规则的全仓总数超过上限即失败；余量快用完时打印提示（不是失败）。
//   --explain：逐条列出当前债务（文件:行 + 违规声明）并给出该属性族可用的 token，
//              用来替代“红灯 → 猜该用哪个 token”的循环。不判失败。
//   --update：把上限同步为当前总数（上调逐条打印 RAISED，diff 里看得见）。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const uiSrc = join(repoRoot, 'packages', 'web', 'ui', 'src');
const baselinePath = join(repoRoot, 'scripts', 'ui-token-baseline.json');

/**
 * token 层：字面值的唯一合法住处，不参与计数。
 *
 * `design/` 是 Nova 自己的层（移植层 `styles/` 已在 7A 扫尾中删除），只出现在
 * `src/` 顶层，所以按路径第一段判即可。
 */
const TOKEN_DIRS = new Set(['design']);

/** 五条规则，顺序即报告顺序。 */
const RULES = ['spacing', 'radius', 'shadow', 'duration', 'ease'];

/**
 * 余量：允许的总数增长。
 *
 * 固定 +N 而不是百分比——债务是**绝对条数**，百分比会让大规则（spacing 本来几十处）
 * 的余量大到失去意义，而小规则（shadow 只有两处）又几乎没有余量。
 * 每条规则的余量刻意取「日常几处改动照得住，系统性蔓延照不住」的量级。
 */
const HEADROOM = { spacing: 20, radius: 10, shadow: 6, duration: 12, ease: 12 };

/** 只扫组件 sheet（`*.module.css`）。token 层与普通 `.css`（挂载表）都不是组件。 */
function sheets() {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (rel === '' && TOKEN_DIRS.has(entry.name)) continue;
        walk(abs, relPath);
      } else if (entry.name.endsWith('.module.css')) {
        out.push({ rel: relPath, text: readFileSync(abs, 'utf8') });
      }
    }
  };
  walk(uiSrc, '');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * 声明对 `prop: value;`。值里允许换行，但不跨 `;` 与 `{}`——后者顺带把选择器
 * （`.foo:hover {`）排除在外：它够不到分号。
 */
const DECL_RE = /([a-z-]+)\s*:\s*([^;{}]+);/g;

/** 剥掉注释后的全部声明。 */
function declarations(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  for (const [, prop, value] of stripped.matchAll(DECL_RE)) {
    out.push({ prop: prop ?? '', value: (value ?? '').trim() });
  }
  return out;
}

/**
 * 剥掉 `var(--name` 的**名字**，保留 fallback。
 *
 * 这一步是必需的，否则 `var(--nova-ease-out)` 里的 `ease-out` 会被当成字面缓动
 * ——token 名撞上规则词。反过来 fallback 必须留下：`var(--ds-ease-in-out,
 * ease-in-out)` 的兜底值是真会生效的字面量。
 */
const bareOf = (value) => value.replace(/var\(\s*--[a-z0-9-]+/gi, 'var(');

/** 非零 px 字面量；`0px` 语义就是 0，不算间距决策。 */
const hasPx = (value) => /\d*\.?\d+px/.test(value.replace(/0px/g, '0'));

const DURATION_RE = /\d*\.?\d+(?:ms|s)\b/;
const EASE_RE = /\b(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)\b|cubic-bezier\(/;

const isSpacing = (p) =>
  p === 'padding' ||
  p.startsWith('padding-') ||
  p === 'margin' ||
  p.startsWith('margin-') ||
  p === 'gap' ||
  p === 'row-gap' ||
  p === 'column-gap';

const isMotion = (p) =>
  p === 'transition' || p === 'transition-duration' || p === 'animation' || p === 'animation-duration';

/** 一个声明命中的规则（一个 `transition: 120ms ease-out` 可同时计 duration 与 ease）。 */
function rulesOf(prop, value) {
  const bare = bareOf(value);
  const hits = [];
  if (isSpacing(prop) && hasPx(bare)) hits.push('spacing');
  if (prop === 'border-radius' && hasPx(bare)) hits.push('radius');
  if (prop === 'box-shadow' && !/^none$/.test(bare) && !/^var\(\)$/.test(bare)) hits.push('shadow');
  if (isMotion(prop)) {
    if (DURATION_RE.test(bare)) hits.push('duration');
    if (EASE_RE.test(bare)) hits.push('ease');
  }
  return hits;
}

/** 一个 sheet 的五条规则计数（零值也返回，便于逐规则比对）。 */
function countsOf(css) {
  const counts = Object.fromEntries(RULES.map((rule) => [rule, 0]));
  for (const { prop, value } of declarations(css)) {
    for (const rule of rulesOf(prop, value)) counts[rule]++;
  }
  return counts;
}

/**
 * 带行号的声明清单（--explain 用）。注释替换为等长空白但保留换行，
 * 这样行号与源文件一致。
 */
function declarationsWithLines(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const out = [];
  for (const match of stripped.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)) {
    const line = 1 + (stripped.slice(0, match.index ?? 0).match(/\n/g)?.length ?? 0);
    out.push({ prop: match[1] ?? '', value: (match[2] ?? '').trim(), line });
  }
  return out;
}

/** token 按声明顺序（升序阶梯）而不是字典序，`space-8` 排在 `space-16` 前面。 */
function tokenNames() {
  const names = new Set();
  const dir = join(uiSrc, 'design', 'tokens');
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.css')).sort()) {
    const text = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return [...names];
}

/** 五条规则各自可用的 token 前缀。 */
const TOKEN_FAMILIES = {
  spacing: ['--nova-space-', '--nova-row-'],
  radius: ['--nova-radius-'],
  shadow: ['--nova-shadow-', '--nova-elevation-'],
  duration: ['--nova-dur-'],
  ease: ['--nova-ease-'],
};

const sheetList = sheets();
const perSheet = sheetList.map((sheet) => ({ rel: sheet.rel, counts: countsOf(sheet.text) }));
const totals = Object.fromEntries(RULES.map((rule) => [rule, 0]));
for (const { counts } of perSheet) {
  for (const rule of RULES) totals[rule] += counts[rule];
}

/** 上限表：`{ spacing: N, ... }`，缺项按「当前值」对待（首次生成时不会误红）。 */
let baseline = {};
try {
  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'));
  // 旧格式（逐 sheet 的 `{ rel: { rule: n } }`）不再被读取：它记的是账本布局，
  // 不是债务上限。逐文件豁免已经证明只会逼人记账，所以这里直接重建。
  if (typeof parsed.spacing === 'number') baseline = parsed;
} catch {
  /* 缺文件：按当前值兜底，见下 */
}

if (process.argv.includes('--explain')) {
  const names = tokenNames();
  let total = 0;
  for (const sheet of sheetList) {
    const hits = [];
    for (const decl of declarationsWithLines(sheet.text)) {
      for (const rule of rulesOf(decl.prop, decl.value)) hits.push({ ...decl, rule });
    }
    if (hits.length === 0) continue;
    total += hits.length;
    console.log(`\n${sheet.rel} — ${hits.length} 处`);
    for (const hit of hits) {
      const prefixes = TOKEN_FAMILIES[hit.rule] ?? [];
      const candidates = names.filter((name) => prefixes.some((prefix) => name.startsWith(prefix)));
      console.log(`  ${hit.line}: ${hit.prop}: ${hit.value}   [${hit.rule}]`);
      console.log(`      → ${candidates.length > 0 ? candidates.map((name) => `var(${name})`).join(' / ') : '（该族没有 token）'}`);
    }
  }
  console.log(`\n共 ${total} 处字面量（当前债务；上限见 scripts/ui-token-baseline.json）。`);
  process.exit(0);
}

if (process.argv.includes('--update')) {
  const next = {};
  let raised = 0;
  let lowered = 0;
  for (const rule of RULES) {
    next[rule] = totals[rule] + HEADROOM[rule];
    const was = baseline[rule];
    if (was === undefined) continue;
    if (next[rule] > was) {
      raised++;
      console.log(`  (RAISED) ${rule}: 上限 ${was} → ${next[rule]}（当前 ${totals[rule]}）`);
    } else if (next[rule] < was) {
      lowered++;
    }
  }
  writeFileSync(baselinePath, JSON.stringify(next, null, 1) + '\n');
  console.log(
    `✓ UI token 上限已同步：上调 ${raised}、下调 ${lowered}（当前债务 spacing ${totals.spacing} · radius ${totals.radius} · shadow ${totals.shadow} · duration ${totals.duration} · ease ${totals.ease}）`
  );
  if (raised > 0) console.log('⚠ 有上限被上调——确认这次增长是有意的，commit diff 会带上它。');
  process.exit(0);
}

const failures = [];
const tight = [];
for (const rule of RULES) {
  const now = totals[rule];
  // 缺上限（首次运行 / 新规则）时以当前值为上限：不制造与本人改动无关的红灯。
  const was = baseline[rule] ?? now;
  if (now > was) {
    failures.push(`${rule}: 全仓 ${now} 处 > 上限 ${was} —— 新代码用 var(--nova-*)，确有理由才 pnpm gates:update`);
  } else if (was - now <= Math.max(1, Math.floor(HEADROOM[rule] / 4))) {
    tight.push(`  · ${rule}: ${now}/${was}（余量 ${was - now} 处快用完）`);
  }
}

if (failures.length > 0) {
  console.error('✗ UI token 债务上涨：');
  for (const f of failures) console.error('  ' + f);
  // 指出涨在哪里，让作者一眼看到要去改哪个 sheet —— 这是提示，不是额外门槛。
  console.error('\n各 sheet 当前字面量分布（仅列非零）：');
  for (const { rel, counts } of perSheet) {
    const nonZero = RULES.filter((rule) => counts[rule] > 0).map((rule) => `${rule} ${counts[rule]}`);
    if (nonZero.length > 0) console.error(`  ${relative(uiSrc, join(uiSrc, rel)).replace(/\\/g, '/')}: ${nonZero.join(' · ')}`);
  }
  process.exit(1);
}
console.log(
  `✓ UI token：${sheetList.length} 个 sheet 的债务在全仓上限内（spacing ${totals.spacing} · radius ${totals.radius} · shadow ${totals.shadow} · duration ${totals.duration} · ease ${totals.ease}）`
);
if (tight.length > 0) {
  console.log(`\n⚠ ${tight.length} 条规则的余量快用完（不是失败）：`);
  for (const line of tight) console.log(line);
}
