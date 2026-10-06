// UI token 纪律门禁（docs/NOVA-DESIGN-SYSTEM.md §5）。
//
// 量的是**债务**，不是"这个 CSS 写得漂不漂亮"：组件 sheet 里不得出现
// spacing / radius / shadow / duration / ease 的字面量。
//
// 允许的字面值是**封闭清单**（§5.2）：border-width、hairline 1px、icon size、
// SVG 绘制尺寸、特殊图形几何。五条规则的属性清单刻意不含这些——所以
// `border: 1px solid …`、`stroke-width: 1.5`、`width: 16px` 都不会被计。
//
// 基线棘轮：现状入账，只许减少。与 structure-budget 同哲学——放宽必须是一次
// 显式、diff 可见的动作（--update），而不是随手绕过。
//
// 禁止把基线变成几千行白名单：那等于把守卫变成新的技术债。exception 只能来自
// §5.2 的封闭集合，不能为了凑数新增 token（`--nova-space-editor-inline-special-1`
// 比硬编码更糟）。
//
// 语义：
//   check（默认）：任一文件任一规则超出基线即失败；低于基线的条目打印为可收紧。
//   --update [子串...]：把基线同步为当前计数；上调逐条打印 (RAISED)。
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const uiSrc = join(repoRoot, 'packages', 'web', 'ui', 'src');
const baselinePath = join(repoRoot, 'scripts', 'ui-token-baseline.json');

/**
 * token 层：字面值的唯一合法住处，不参与计数。
 *
 * `styles/` 是移植来的 harness 层，`design/` 是 Nova 自己的层；两者都只出现在
 * `src/` 的顶层，所以按路径第一段判即可。
 */
const TOKEN_DIRS = new Set(['styles', 'design']);

/** 五条规则，顺序即报告顺序。 */
const RULES = ['spacing', 'radius', 'shadow', 'duration', 'ease'];

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

/** 一个 sheet 的五条规则计数（零值也返回，便于逐规则比对）。 */
function countsOf(css) {
  const counts = Object.fromEntries(RULES.map((rule) => [rule, 0]));
  for (const { prop, value } of declarations(css)) {
    const bare = bareOf(value);
    if (isSpacing(prop) && hasPx(bare)) counts.spacing++;
    if (prop === 'border-radius' && hasPx(bare)) counts.radius++;
    if (prop === 'box-shadow' && !/^none$/.test(bare) && !/^var\(\)$/.test(bare)) counts.shadow++;
    if (isMotion(prop)) {
      if (DURATION_RE.test(bare)) counts.duration++;
      if (EASE_RE.test(bare)) counts.ease++;
    }
  }
  return counts;
}

const current = {};
for (const sheet of sheets()) {
  const counts = countsOf(sheet.text);
  const nonZero = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
  if (Object.keys(nonZero).length > 0) current[sheet.rel] = nonZero;
}

const totals = (table) => {
  const out = Object.fromEntries(RULES.map((rule) => [rule, 0]));
  for (const rules of Object.values(table)) {
    for (const [rule, n] of Object.entries(rules)) out[rule] += n;
  }
  return out;
};

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  if (!process.argv.includes('--update')) {
    console.error('✗ 缺 scripts/ui-token-baseline.json —— 先跑 --update 生成基线');
    process.exit(1);
  }
}

if (process.argv.includes('--update')) {
  const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const next = { ...baseline };
  let raised = 0;
  let lowered = 0;
  for (const [file, rules] of Object.entries(current)) {
    if (filters.length > 0 && !filters.some((s) => file.includes(s))) continue;
    const old = next[file];
    next[file] = rules;
    if (old === undefined) continue;
    for (const rule of RULES) {
      const before = old[rule] ?? 0;
      const after = rules[rule] ?? 0;
      if (after > before) {
        raised++;
        console.log(`  (RAISED) ${file} · ${rule}: ${before} → ${after}`);
      } else if (after < before) {
        lowered++;
        console.log(`  (lowered) ${file} · ${rule}: ${before} → ${after}`);
      }
    }
  }
  for (const file of Object.keys(next)) if (current[file] === undefined) delete next[file];
  const sorted = {};
  for (const file of Object.keys(next).sort()) sorted[file] = next[file];
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 1) + '\n');
  const t = totals(current);
  console.log(
    `✓ 基线已同步：下调 ${lowered}、上调 ${raised}、覆盖 ${Object.keys(current).length} 个 sheet`
  );
  console.log(
    `  当前债务：spacing ${t.spacing} · radius ${t.radius} · shadow ${t.shadow} · duration ${t.duration} · ease ${t.ease}`
  );
  if (raised > 0) console.log('⚠ 有计数被上调——确认这次增长是有意的，commit diff 会显眼地带上它。');
  process.exit(0);
}

const failures = [];
const tighten = [];
for (const [file, rules] of Object.entries(current)) {
  const base = baseline[file];
  for (const rule of RULES) {
    const now = rules[rule] ?? 0;
    const was = base?.[rule] ?? 0;
    if (now > was) {
      failures.push(
        `${file} · ${rule}: ${now} 处 > 基线 ${was} —— 新代码用 var(--nova-*)，确有理由才用 --update <子串> 显式放宽`
      );
    } else if (now < was) {
      tighten.push(`  · ${file} · ${rule}: ${now}/${was}（可收紧）`);
    }
  }
}
for (const file of Object.keys(baseline)) {
  if (current[file] === undefined) tighten.push(`  · ${file}: 已无字面量（可从基线移除）`);
}

if (failures.length > 0) {
  console.error('✗ UI token 债务上升：');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
const t = totals(current);
console.log(
  `✓ UI token：${Object.keys(current).length} 个 sheet 的字面量均未超过基线（spacing ${t.spacing} · radius ${t.radius} · shadow ${t.shadow} · duration ${t.duration} · ease ${t.ease}）`
);
if (tighten.length > 0) {
  console.log(`\n⚠ ${tighten.length} 条基线可以收紧（不是失败，是棘轮该往下走了）：`);
  for (const line of tighten.slice(0, 20)) console.log(line);
  if (tighten.length > 20) console.log(`  … 另有 ${tighten.length - 20} 条`);
}
