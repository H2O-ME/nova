---
'@nova-agent/core': minor
'@nova-agent/plugins': patch
'@nova-agent/cli': patch
'@nova-agent/web': patch
'@nova-agent/plugin-context': minor
---

**宿主不再按名字认识任何内置插件。** 三处「宿主读某个插件的行配置」全部拆掉，改为插件自带设置：

- **`config` 比较按值，不按身份**（`core/src/plugin/config-equal.ts`）。行配置是从配置文件**每次 roster 重读**的数据，同一份没改的文件读两次会得到内容相同、对象不同的两份；按身份比较于是把「文件没变」读成「每一行都被编辑过」，**每次换工作区、每次设置翻转都把每个可配置插件拆下来重装一遍**——正是 entry 树要消灭的「整表重建」。`plugin` / `isolate` / `intercept` 仍是身份比较：那些是**代码**。
- **`bash` / `search` 的设置改由各自的 `Config` schema 承载**（`apply(ctx, config)` 里读）。此前它们经宿主侧的构造参数收设置，于是宿主必须维护一张「哪些内置插件可配置」的名字表（`CONFIGURED_BUILTINS`）和一个指纹来决定何时重建插件对象。现在设置走的是**第三方插件也走的那条路**，loader 自己 diff `config`，所以指纹、名字表、重建逻辑一并删除——内置插件对象**每个 kernel 只构造一次**。新增一个可配置项现在只改插件自己那个文件。
- **新增 `shell` 服务键**（18 个）：上下文片段要告诉模型 `shell=<name>`，而这个答案只有**跑命令的那个插件**知道。此前宿主在 `runtime-env.ts` 里 `entries.find(e => e.id === 'bash')` 去读它的 `shellPath`——宿主源码里的插件名，而且操作者一改 `shellPath`、或换掉执行插件，提示词就会与实际执行不一致。现在 `bash` 自己 `ctx.provide(shell, { name, path })`，宿主读服务、无 provider 时回落到探测环境。**行关掉即服务消失**（provide 挂在 fiber 上）。

**`ToolCallKind` 现在长在每一张 call view 上**，不只是 `generic`（`core/src/presentation.ts`）。专用卡说「怎么画」（终端转录 / diff / 命中列表），`kind` 说「它做了什么」；此前只有 `generic` 有 `kind`，于是任何要**归类或汇总**工作的消费者都得自己按工具名分类——WebUI 的进程分组标题就是这么写的，那份分支已经漂了（它猜了 `web_search` / `web_fetch` 两个本仓不存在的工具，并漏掉 `list_dir` / `jobs` / `get_time`）。现在 `process-summary.ts` 直接读 `view.kind`，工具名不再参与分类。词汇表同时补上 `question`（`ask_user_question` 的类别，此前被笼统归为 `other`），于是 `Record<ToolCallKind, …>` 的文案表由**类型**（而非人工清单）保证齐备——`packages/core/test/presentation.test.ts` 里那份手抄的联合字面量已删除，改为对公开分类器做一次往返。

**行按 entry id 认，fiber 按插件自己声明的 `name` 认——这两者不同，而有的地方按错了键。** `@nova-agent/plugin-context` 的行 id 与它声明的 `name`（`context`）不一致，于是：

- `describePlugins` 用容器的 `root.roster()` 查**行 id**，把已激活的行报成 `disabled`；导航由 `page && enabled` 派生，所以它的设置页从导航里消失。改为 `PluginHost.entry(row.id)`（同处新增 `PluginHost.entry` / `.entries()`，行侧查询的唯二入口）。
- `setPluginEnabled` 的校验同样按 fiber 名查，于是 `setPluginEnabled('@nova-agent/plugin-context', true)` 在插件**已经加载**的情况下仍然抛 `did not load after enabling`。改为按行读 `fiber` / `error`。

**开关改了文件，插件树却按装配时的快照重建。** `buildTree` 读 `opts.config.plugins.entries`（装配瞬间的副本），而写者改的是配置文件，于是 `reroster` 重建的是翻转**之前**的树，开关拿自己的陈旧答案报错——**两个方向、每一行都失败**。现在 `persist` 端口多一个可选的 `readPluginEntries()` 活读，`buildTree` 的 entries 变成参数，`reroster` 每次先重读文档。这与 `models[]` 早已采用的写法是同一条（拥有配置文件的壳负责读，装配方不做长期缓存），`cli/web-mode.ts` 提供实现。

**线上 `set_plugin_enabled` 寻址不到任何扩展行。** 它的名称校验用的是技能名的窄文法（`^[a-z0-9][a-z0-9_.-]*$`），凡模块 spec 形态的行 id（`@nova-agent/plugin-ptc`、`./local.mjs`）都被拒——设置面板因此关不掉也开不了任何一个扩展插件，而拒绝文案还在怪操作者的输入。改为复用相邻 `plugin_request` 同款的 `PLUGIN_ID_RE`（仍是有界、无空白的 token）；`set_skill_enabled` 保留窄文法，因为技能名确实是普通标识符。

**`@nova-agent/plugin-context` 补上自己的 `manifest`。** 它的文件头一直写着「It is `advanced`」，但它没有 manifest，而 `manifestOf` 对无 manifest 的插件 fail-open 成 `standard`——于是它默认**开启**，与自己（及 `AGENTS.md` §3）的声明相反。现在声明 `tier: 'advanced'`，与 `subagent` / `ptc` 一致：全新安装不带上下文洞察，需要时在插件管理里打开。
