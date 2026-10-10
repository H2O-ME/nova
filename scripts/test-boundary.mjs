// 测试边界门禁（docs/NOVA-TESTING.md §3.3、docs/NOVA-BOUNDARIES.md §3.4）。
//
// 测试同样受架构边界管理。默认优先：
//
//     package public API + test-support + contract harness
//
// 而不是 `test → 另一个包的 src/internal/*`。两条规则：
//
//  1. **跨包只能走公开入口**：测试里出现 `@nova-agent/<pkg>/<后缀>` 即违规。
//     测试用相对路径引用**本包自己**的 src/ 是单元测试的正常形态，不算违规
//     ——正是这一点让它与 dep-direction 的深路径规则不重复：那条管 src，这条
//     管 test，而 test 里最常见的越界形态是相对路径，不是包说明符。
//  2. **不得用相对路径逃出本包**：`packages/<pkg>/test/**` 下的相对引用解析后
//     必须仍落在 `packages/<pkg>/` 内。逃出去就是在直读另一个包的内部实现。
//
// 现状：两条都是**零违规的纯棘轮**——跨包引用全走公开入口，零深度 ≥3 的相对
// 引用。作用与 dep-direction 的深路径规则相同：让第一次出现时门禁就把理由说
// 出来，而不是等 review 发现。
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSources, isDir, stripComments, workspaceLeafDirs } from './gates-lib.mjs';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const packagesDir = join(repoRoot, 'packages');

/**
 * 模块说明符：`from '…'`、`import('…')`、副作用 `import '…'`。
 *
 * 先剥注释再匹配——注释里写一句 `import x from '@nova-agent/core/src/…'` 是在
 * 解释规则，不是在违反规则。（stripComments 来自 gates-lib：字符串字面量保持
 * 原样，字符串里的注释标记不会被误剥。）
 */
const SPEC_RE = /(?:\bfrom\b|\bimport\b\s*\(?)\s*['"]([^'"]+)['"]/g;

/** 跨包深路径：`@nova-agent/<pkg>/<后缀>`。 */
const DEEP_PKG_RE = /^@nova-agent\/[a-z-]+\/.+/;

/** 裸包说明符（公开入口）：`@nova-agent/<pkg>`。 */
const BARE_PKG_RE = /^@nova-agent\/[a-z-]+$/;

const violations = [];
let scanned = 0;
let publicEntry = 0;

for (const dir of workspaceLeafDirs(packagesDir, 'test')) {
  for (const file of collectSources(dir)) {
    scanned++;
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    // 本包根：`packages/<pkg>`——嵌套成员的测试（`packages/web/ui/test`）也归
    // 宿主包 `packages/web` 管，因为相对引用的合法上界就是它。
    const pkgRoot = join(packagesDir, rel.split('/')[1] ?? '');
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const [, spec] of code.matchAll(SPEC_RE)) {
      if (DEEP_PKG_RE.test(spec)) {
        violations.push(
          `${rel}: ${spec} —— 测试跨包只能走公开入口（NOVA-TESTING §3.3）`
        );
        continue;
      }
      if (BARE_PKG_RE.test(spec)) {
        publicEntry++;
        continue;
      }
      if (!spec.startsWith('.')) continue;
      const resolved = resolve(dirname(file), spec);
      const inside = relative(pkgRoot, resolved);
      if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
        violations.push(
          `${rel}: ${spec} —— 相对引用逃出了本包（${relative(repoRoot, pkgRoot).replace(/\\/g, '/')}），测试不得直读另一个包的内部实现（NOVA-BOUNDARIES §3.4）`
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error('✗ 测试边界违规：');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(
  `✓ 测试边界：${scanned} 个测试文件全部合规（跨包引用 ${publicEntry} 处均走公开入口，零相对逃逸）`
);
