---
name: nova-dev
description: >-
  NovaAgent 仓库（D:\web\agent）的开发规程：开工前要读哪几份文档、结论必须有哪种证据、
  参照系是通用化纲领（不再是 dsh）、修复必须配什么测试、收尾跑哪些门禁，以及本仓高频缺陷族
  （声明与实现相反、第二份实现、只写不读）的识别方法。
  当用户在 NovaAgent 仓库里要求改代码、修 bug、调整 UI、加功能，
  或说「按 nova-dev 规矩做」「按仓库规矩来」时使用。
  其他仓库的通用编码任务不要触发（改用该仓库自己的 AGENTS.md）。
---

# NovaAgent 开发规程

本技能是 `D:\web\agent` 这个仓库的工作协议。仓库的**唯一权威文档是 `AGENTS.md`**——
本技能不复制它的内容，只规定**怎么用**它，以及那些踩过坑才写下来的纪律。

## 一、开工前必读（不要跳过）

按顺序读，读你**要改的那一节**就够，但必须真读：

1. **`AGENTS.md`** —— 唯一权威。机制的唯一事实来源：内核协议、插件分层、surface 缝、
   审批与权限、PTC、goal、验证与门禁口径。**机制变了就改这里**，行数口径是
   `scripts/structure-budget.json` 的 `split('\n').length`。
2. **`docs/NOVA-GENERALIST.md`** —— **通用化纲领**：定位、执行契约、批次表（G 系列）、
   每批开工条件与删除判据。改任何与"通用化 / UI 形态 / 批次"相关的东西前先读它。
3. **`docs/dsh-parity-inventory.md`** —— **历史参照（非验收口径）**。它是"哪些 UI 是
   移植来的"的索引；各条「记名偏离（勿修回）」的结论继续有效——那些是实测否决，
   别当 bug 改回去。
4. **历史参照源码（只读）**：`D:\web\agent\deepseek-harness-master\` 与已安装的
   `D:\DeepSeek Harness\resources\app.asar\dsh\`。**只用于查移植来源，不是对齐权威**。
   **永远不要修改它们**。
5. 动手前先确认你要改的文件在依赖白名单里属于哪一层（`AGENTS.md` §3）。

> 只读文档就下结论是不够的：文档常常滞后于代码。**代码是行为的真相，文档是意图的真相**，
> 两者冲突时以代码为准，然后**把这个冲突本身当成一个缺陷**去修（改文档或改代码）。

## 二、输出语言

- 对用户说话：**中文**。
- 工具名、命令、标识符、文件路径：保持英文/原样。
- 源码注释：**英文**。
- 面向用户的界面文案：**中文**，且必须走 `settings/copy/` 这类文案表，不硬编码在组件里。

## 三、核心纪律

### 1. 参照系是通用化纲领，不是 dsh

**2026-10-09 起 `docs/NOVA-GENERALIST.md` 把 Nova 定为通用型 agent 并要求脱离 dsh。**
`docs/dsh-parity-inventory.md` 降级为**历史参照、非验收口径**；新代码**不得**再逐值对齐 dsh。
（旧纪律"对齐 dsh，不要自创"已作废。）

遇到「这里该长什么样」，权威依次是：

1. `docs/NOVA-GENERALIST.md` 的裁决（定位、执行契约、归属划分、批次与删除判据）；
2. `docs/NOVA-DESIGN-SYSTEM.md` §2 已冻结的视觉方向（中性优先 / 单一 accent /
   暗色一等公民 / 小圆角 / 无阴影 / 仅 opacity+transform 动效）；
3. `docs/NOVA-UI-ARCHITECTURE.md` 的结构规范（§2/§5 尚待 G5/G6 重定）。

dsh 的**唯一**剩余用途：查「哪些 UI 是移植来的、移植自哪个模块」——G7a 删除
"ported from" 注释与逐值几何时用它定位。

**偏离要记名**：与已冻结方向的有意偏离，写进 `docs/dsh-parity-inventory.md` 并注明理由——
**自创而不记名，下一个人会当成 bug 改回去**。用户的新意见若与已冻结方向冲突，
**出方案让他拍板**，不要直接改（2026-10-09 他驳回过一版直接开跑的重构计划）。

### 2. 结论必须有证据

- **UI 的间距 / 尺寸 / 颜色 / 布局问题，必须真机量测**，不许凭 CSS 推断出结论。
  做法：起 `node packages/cli/dist/index.mjs --web`（配 `NOVA_WEB_PORT`），
  用 CDP（headless Edge + `Runtime.evaluate`）读 `getBoundingClientRect()` /
  `getComputedStyle()`，把**具体像素数**报出来。
- 需要历史会话做夹具时，**用真实的会话日志**（`~/.nova/sessions/...jsonl`）在页面里
  发一条 `resume` 帧加载，比造假 provider 便宜。
- 改完 CSS 后**必须重建产物**才量得到：`pnpm --filter nova-web-ui build`。
- 报数字时给出**参照物**（例：「面板 680 / 输入卡 712，两侧各差 16px」），
  孤立的一个数说明不了对错。
- **量测脚本、截图、浏览器 profile 目录用完立刻删干净**，不要留在仓库里。

### 3. 每个修复配一条 killing test，并做变异验证

只写测试不够。**把代码改回旧行为，测试必须变红**；不变红说明测试是空绿的
（断言的是别的东西，或者断言根本不会失败）。

变异验证要跑，不要只在脑子里想。做完把代码恢复，再跑一次确认绿回来。

测试断**契约与不变量**（顺序、存在性、降级行为、宽度守恒），不要断完整文案串——
观感微调不该触发红测试。**UI 测试车道没有 DOM**，用 `renderToStaticMarkup` 或纯函数；
**`readFileSync` 读源码做断言是反模式**（唯一例外是 `style-guard.test.ts` 这类守卫本身）。

### 4. 优先怀疑三个高频缺陷族

本仓抓到的真 bug 绝大多数属于下面三类。**专门去找它们，比通读代码有效**：

1. **声明与实现相反** —— prop/字段/注释声明了 A，代码做的却是 B。
   - 典型：prop 声明了、类型对了、唯一调用点**没传**，于是永远走 `undefined` 分支，
     相关的 `<button>`/`onClick`/文案全是不可达的死代码。
   - 典型：注释写着「只在 hero 渲染」，代码却无条件渲染。
   - 查法：对一个 prop/字段，全仓搜它的**消费者**；只有一个消费者且没传值就是它。
2. **第二份实现** —— 同一件事有两处各算各的。
   - 典型：同一个状态被两个表面各自派生，一个做了投影、另一个没做，于是同屏显示两个答案。
   - 处理：**合并成一处**（导出那个纯函数），让两处不可能再分歧。
3. **只写不读 / 只读不写** —— 字段写进去没人读，或读了却没人写。
   - 典型：`UploadedFile.path` 只写不读；`creating` 状态三处写入、全仓零读取。
   - 查法：新加/改动字段时，同时确认**生产者与消费者都在**。声明齐全而生产者缺席，
     测试会照着手写 fixture 一路绿。

### 5. 单一实现

同一件事只允许一个实现。发现第二份就把它并掉，不要新建平行的一份。
本仓已有的单一实现点（新代码应复用而非重造）：审批答案解析、文本卫生、呈现形状、
视图解析、斜杠命令语义、前端格式化、路径布局、缺失工具结果补齐、模型 id 对账。

### 6. 一次只改一件事

一个改动解决一个问题。不要在修 bug 的同时顺手重构无关代码——那会让变异验证
和 review 都失去意义。**改动范围越小，「测试变红 = 这个改动造成的」这句话才成立。**

## 四、命令备忘

```bash
pnpm build        # pnpm -r build：各包 tsdown 构建（连带产出前端产物）
pnpm test         # vitest run（不联网）
pnpm typecheck    # pnpm -r typecheck
pnpm lint         # oxlint packages
pnpm check        # 快环：lint + gates + --changed 测试 —— 改完就它
pnpm verify       # 全环：build + typecheck + test + gates —— 收尾
pnpm gates        # 结构棘轮：依赖方向 + 逐文件行数上限
pnpm gates:update # 同步行数上限（下调静默；上调逐条 RAISED）
```

**几个必须记住的坑**：

- `pnpm nova` 跑的是 **`packages/cli/dist`**——改完 `src` 必须 `pnpm build` 才生效。
  （`pnpm dev` 走 tsx 直读源码，排查时更快。）
- 前端改动必须 `pnpm --filter nova-web-ui build` 才会进 `packages/web/public/assets`。
  `index.html` 是 `no-cache`、资产是内容哈希，所以**刷新浏览器即可**生效。
- 测试调用方式：`pnpm exec vitest run <路径>`（仓库根跑）可以；
  **`pnpm --filter <pkg> exec vitest run <pattern>` 会报 "No test files found"**，别用这种。
- `packages/web/ui/src`（全仓最大的一块代码）**既无行数预算、也无依赖方向检查**——
  `pnpm gates` 兜不住它，得人工守（只允许 `@nova-agent/core` 的类型/纯数据形状 + React）。
- 改 `core` / `plugins` 后，依赖方的 typecheck 读的是**已构建的 `dist/index.d.mts`**，
  所以要先 `pnpm build` 再 typecheck。
- 行数超上限时用 `pnpm gates:update [子串]`，**增长必须显式发生过**（它会打印 RAISED）。
  上限 = 当前 + max(10, 10%)，接近上限时门禁会打印前瞻提示（那只是提示，不是失败）。

## 五、安全红线

- **绝不修改真实的 `~/.nova/config.json`**（除非用户明确要求）。
  实机检查一律用临时 home（`mkdtemp`）。
- 测试隔离由 `vitest.config.ts` 的 `setupFiles` → `packages/test-setup.ts` 保证
  （把 `USERPROFILE`/`HOME` 指向临时目录）。**不要绕过它**。
- `.changeset/*.md` 用中文正文明说改了什么、为什么。
- 不要开一堆子智能体。默认自己单线程做；确实需要并行时**先说明理由**，
  并让每个子任务改**不相交的文件**。

## 六、收尾清单

1. `pnpm check` 快环绿。
2. `pnpm verify` 全环绿（build + typecheck + **全部测试** + gates）。
3. `pnpm gates` 通过；lint 0 error（warnings 是存量，不必逐一清）。
4. 前端改动：`pnpm --filter nova-web-ui build`，确认产物哈希变了、`index.html` 指向新哈希。
5. 每处修复配 killing test，并**跑过变异验证**。
6. 意图层面的变化写进 `AGENTS.md` 与 `docs/NOVA-GENERALIST.md`；偏离记进
   `docs/dsh-parity-inventory.md`；用户可见的变化写一份 `.changeset/*.md`。
7. 临时文件（脚本/截图/profile）删干净。

## 七、汇报格式

用中文，结构固定，让用户能快速核对：

- **改了什么** —— 一处一行，说清根因，不要只描述表层现象。
- **证据是什么** —— 具体命令 + 真实数字/结果（例：`pnpm verify` 156 文件 1755 断言；
  面板 680 / 输入卡 712）。
- **什么没做，为什么** —— 例如「判定为有意偏离，未改」，或「需要新协议帧，未立项」。
- **还剩什么需要用户拍板** —— 把判断权交回去，不要替用户决定「什么算对」。

**诚实优先于好看**：不确定就说不确定，没实测就说没实测，删掉的东西就说明删了。
