---
'@nova-agent/plugins': minor
'@nova-agent/web': minor
'@nova-agent/cli': minor
---

**插件分层（core / standard / advanced）+ 第三方插件开关真生效 + 插件管理页重做与汉化。**

三个用户可感知的故障，根因各不相同：

- **第三方插件无法关闭**：`runtime-roster.ts` 把 `plugins.extra` 加载的插件**原样**塞进工具宿主，绕过了 `applyRoster` 的过滤，也从 `unknownDisabled` 的入参里缺席。于是第三方插件的名字永远进不了「关掉」这条路径——开关点了也没用。现在**四个来源（surface / builtin / extra / 内核命令）走同一道闸**（`roster-filter.ts` 的 `loadableRoster`），extra 一并纳入拼写检查。
- **`jobs` 关不掉，报错还指着一个用户没见过的名字**：能力服务 provider 与内置工具插件**同名 `jobs`**，而"核心不可关"清单把两者一起锁了——工具行渲染了开关，每次点击都抛 `load-bearing`。provider 改名 `jobs-service`（**服务键仍是 `jobs`**，所有 `ctx.get(jobsKey)` 读者零改动），工具插件保留 `jobs`；那份手写清单删除，改由 tier 表派生（`NON_DISABLABLE_PLUGINS = CORE_PLUGINS`），**不再有第二份会漂移的名单**。
- **`subagent` 这类进阶能力默认常开**：roster 无条件传 `subagent: {…}`，于是它既关不掉（不在核心清单里却总被装配）又不符合「按需开启」的意图。现在 `subagent` / `ptc` / `qqbot` 是 **advanced：默认关闭，写 `plugins.enable` 才进入 roster**。

### 分层与开关契约

- 新增 `tier: 'core' | 'standard' | 'advanced'`：**core**（不可关、不渲染开关）＝ `toolbox` / `llm` / `approval` / `approval-gate` / `jobs-service` / `spill` / `compaction` / `sessions` / `skills` / `commands` + 基础工具 `fs-read` / `fs-write` / `search` / `ask-user`；**standard**（默认开、可关）＝ `bash` / `jobs` / `todo` / `workspace`；**advanced**（默认关、按需开）＝ `subagent` / `ptc` / `qqbot`。未知名字 fail-open 到 standard——把第三方插件划进 core 会让它**永久不可关**，那正是要修的缺陷。
- **生效规则只有一个函数**（`plugin-tier.ts` 的 `enabledByTier`）：`disable` 命中 → 关（**disable 优先**，安全侧）；否则 `enable` 命中 → 开；否则按 tier 默认。
- **两张表按 tier 分工**：`standard` 的开关写 `plugins.disable`；`advanced` 的开关写 `plugins.enable`（关闭＝移出 enable，**不写 disable**——后者优先，写进去就是一道回不来的单向门）。**唯一的例外是 `ptc`**，理由见下条。`KernelConfig.plugins` 与配置 schema 各加 `enable?: string[]`。
- **`ptc` 是唯一的例外，因为它有第二个录取口**：`code.mode !== 'native'` 本身就是「我要 PTC」，roster 的 `codeModeOptIn()` 会把它翻译成一条 `enable` 表项。于是**只把名字从 `enable` 删掉不够**——推导立刻把它加回来，`reroster()` 后它仍在，校验抛 `plugin "ptc" is still loaded after disabling`：**开关点了就报错，永远关不掉**，正是本次要修的那类单向门，而我们自己犯了同一类。
  修法是 `ptc` 这一行**同时写 `disable`**（`disable` 优先于推导出的 `enable`），并让 `env.state.codeMode` 跟着行状态走（关 → `native`；开 → 若为 `native` 则升 `both`，与 `runtime-builtins.ts` 的取法一致，保证「状态」与「实际加载的插件」不会各说各话）。**两个方向都要写**：只写关不写开，残留的 `disable` 会把它**永久焊死开不回来**——同一个门朝另一边。
  其余 advanced（`subagent` / `qqbot`）没有这个推导，`enable` 单独就能决定，无需这行。
  验证不只断言内存状态：用例把落盘后的两个 list **重新喂给一个新内核**，确认重启后仍是开着的——那才是这类 bug 最容易漏掉的一环（内存对了、磁盘把门焊死了）。
- **迁移是纯派生、不回写**：`toKernelConfig` 对既有配置推导 `enable`——`tools.code.mode` 存在且非 `native` → `ptc`；`qqbot` 块存在 → `qqbot`。`workspace` **刻意不派生**（tier=standard 默认开、disable 优先，该条永远不生效，死代码比没有更糟）。升级后老配置行为逐字不变。
- **中文文案唯一表**（`plugin-labels.ts` 的 `PLUGIN_LABELS`）：`describe()` 与 `describePlugins()` 都从这里取名，缺条目回落到插件自己的 `name`，**绝不编造**。`PluginRosterEntry` / `PluginDescriptor` 各加 `tier` 与 `title`；`WireRosterEntry` 的 `tier` / `title` 可选，老 host 容忍。

### 插件管理页（dsh 式）

- 按 **tier 三组**（核心功能 / 基础能力 / 扩展能力）取代原来的 origin 分组——origin 说的是"谁发布的"，tier 说的才是"读者能对它做什么"。
- 核心行**不渲染开关**并说明 `plugins.locked`；扩展行标注 `plugins.defaultOff`；行可展开（`<li><button aria-expanded>`）看描述与注入的服务名（折叠时保持可扫读）；**启动失败的行排到本组最前**并给出计数。
- 搜索同时匹配中文名、英文名、描述与注入服务名；**移除开关前的确认弹窗**（每次翻转都可原地撤销，真正的安全网是内核侧的 tier 拒绝，它带原因回话）。

### 顺带

- `packages/cli/src/config.ts`（原 302 行、已超上限）把 `models[]` / `providers[]` 两份 zod schema 抽到 `config-schema-models.ts`，两者共用同一个 `modelsSchema`——顶层与供应商内的模型形状本来就是逐字相同的两份拷贝。
- `config-write.ts` 新增 `setPluginsEnabled(names, homedir?)`：严格照 `flipSwitch` 的纪律读 raw 文档、同目录 tmp + rename、**空数组即删键**（"没有进阶插件被开启"是键的缺席，不是 `[]`）；既有导出签名一字未改。
- `web-mode.ts` 把 `setPluginEnabledList` 接进 `persistConfig`（surface 只接一个 writer 就永远开不回 `subagent`）。
- `roster-entry.ts` 的行构建抽成唯一实现 `toWireRosterEntry`，`roster` 帧与 `plugins` 帧两条路径由此**永远同形**。
