// 包间依赖方向门禁（docs/NOVA-BOUNDARIES.md §2 的机械化）。
// 违规即失败：core 不得有上游；其余只允许白名单内的下行依赖。
// 白名单是架构事实，改动它=改架构，应在 diff 里显眼地被审阅。
//
// 除白名单外另有两条**棘轮**（现状均零违规，作用是让第一次出现时理由清楚）：
//   · 深路径包导入——跨包只能走公开入口（internal import gate / surface-to-runtime gate）；
//   · 插件互赖——插件之间不得直接依赖（plugin-to-plugin gate）。
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSources, packageLeafDirs, stripComments, SUBPATH_EXPORTS } from './gates-lib.mjs';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const packagesDir = join(repoRoot, 'packages');

/** 每个包允许直接 import 的下行包（空数组=零上游内核）。
 *
 * 六个包：内核 `core` 与 `plugins`（容器 + 工具 + 内核装配）、`ai`（provider
 * 客户端）、`web`（WebUI surface 后端，含前端子包 `web/ui`）、`qqbot`（渠道
 * 插件示范）、`cli`（surface 装配壳）。
 * surface = 任何消费内核事件流的进程形态，官方 surface 与第三方同地位、只
 * 依赖 core/plugins 公共 API。
 */
const ALLOW = {
  core: [],
  ai: ['core'],
  // plugins 动态装载三个扩展包（spec 表）：名字必须过门禁，但源码不 import
  // 它们（`extensions.ts` 里是字符串 spec + 运行时 import()）。
  plugins: ['core', 'plugin-subagent', 'plugin-context', 'plugin-ptc'],
  qqbot: ['core', 'plugins'],
  // 扩展插件包（advanced 档从主程序出包，按 spec 装载）：只依赖 core——
  // 注册原语与类型剥离探测都住在 core，因此它们不必 import plugins（否则
  // plugins 声明它们为依赖时会成环）。
  'plugin-subagent': ['core'],
  'plugin-context': ['core'],
  'plugin-ptc': ['core'],
  // web 只依赖 core / plugins。Browser/DNA 路由曾经静态 import plugin-context
  // 的 `windowAtSeq`，那让一个**可选扩展**变成这个表面的安装期硬需求；现在
  // 它经 `contextInsights` 能力键取值（`web/src/index.ts` 注入，服务缺席即降级），
  // 与 live 路径同一条通道——「什么在窗口里」仍然只有一份定义，但实现留在扩展里。
  web: ['core', 'plugins'],
  // cli 是产品壳：静态依赖只有内核三件 + WebUI 后端（web）。qqbot 是扩展，经
  // `qqbot-api.ts` **一处动态 import** 装载（包缺席即降级）——它仍在名单里，因为
  // 名单管「允许引用的包」，动态边也是边。其余 surface 一律配置行（`surfaces`）
  // 加载，cli 源码不点名。
  cli: ['plugins', 'ai', 'core', 'qqbot', 'web'],
};

/**
 * 包说明符与它的**深路径尾巴**。
 *
 * 组 1 是包名，组 2 是深路径（`/` 开头的任意后缀；无后缀时为空串）。跨包只允许
 * 走公开入口 `@nova-agent/<pkg>`；`@nova-agent/<pkg>/src/…`、`@nova-agent/<pkg>/dist/…`
 * 一律违规。这一条同时承担两个边界的机械执行：
 *
 *  - **internal import gate**：跨包不得引用别人的内部实现；
 *  - **surface-to-runtime gate**：Web / CLI / QQ 不得 import Runtime 私有实现。
 *
 * 现状：全仓零深路径导入，所以它是**零违规的纯棘轮**——它的作用不是抓现行，
 * 而是让第一条出现时门禁就把理由说出来，而不是等 review 发现。
 * 判据见 `docs/NOVA-BOUNDARIES.md` §3.1 / §3.3。
 */
const IMPORT_RE = /@nova-agent\/([a-z-]+)((?:\/[A-Za-z0-9._-]+)*)/g;
const violations = [];

for (const { pkg, dirs } of packageLeafDirs(packagesDir, 'src')) {
  const allowed = ALLOW[pkg];
  if (allowed === undefined) continue; // not a gated package (no allowlist entry)
  const files = [];
  for (const dir of dirs) files.push(...collectSources(dir));
  for (const file of files) {
    const text = stripComments(readFileSync(file, 'utf8'));
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    for (const [, target, deep] of text.matchAll(IMPORT_RE)) {
      if (!(target in ALLOW)) {
        violations.push(`${rel}: 未知包 @nova-agent/${target}`);
      } else if (!allowed.includes(target) && target !== pkg) {
        violations.push(`${rel}: @nova-agent/${pkg} → @nova-agent/${target} 不在白名单`);
      }
      if (deep !== '' && !SUBPATH_EXPORTS.has(`${target}${deep}`)) {
        violations.push(
          `${rel}: @nova-agent/${target}${deep} —— 跨包只能走公开入口 @nova-agent/${target}，不得引用内部实现（NOVA-BOUNDARIES §3.1）`
        );
      }
      /**
       * 插件之间不得直接依赖（NOVA-BOUNDARIES §3.2）。
       *
       * 与白名单**故意重复**：白名单已把三个扩展包的上游收到只剩 core，但那条
       * 约束是「名单里没写」——放宽名单即失效。这一条是「无论如何都不许」，两条
       * 一起才挡住「顺手加一条白名单让插件互相认识」。
       */
      if (pkg.startsWith('plugin-') && target.startsWith('plugin-') && target !== pkg) {
        violations.push(
          `${rel}: 插件 @nova-agent/${pkg} 直接依赖插件 @nova-agent/${target} —— 跨插件只能走 Contract / Service / Event / Contribution（NOVA-BOUNDARIES §3.2）`
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error('✗ 依赖方向违规：');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(
  `✓ 依赖方向：${Object.keys(ALLOW).length} 个包符合 docs/NOVA-BOUNDARIES.md §2 白名单（含深路径、插件互赖两条棘轮）`
);
