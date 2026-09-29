---
'@nova-agent/core': minor
'@nova-agent/ai': minor
'@nova-agent/plugins': minor
'@nova-agent/web': minor
'@nova-agent/cli': minor
'@nova-agent/qqbot': patch
---

**模型接入改为 BYOK 多供应商、Skills 改认通用 `.agents` 标准、QQ 机器人在 `nova --web` 内真正接入，以及一批会话界面缺陷修复。**

> 插件分层与开关的内容在 `.changeset/plugin-tiers-and-switches.md`，不在此重复。

### 模型接入：初次使用即空壳（BYOK）

- **`~/.nova/config.json` 的 `provider` 变为可选**，新增 `providers[]` 与 `activeProvider`。首次启动不再要求先手写配置文件：产品直接进入设置页，由「设置 → 模型」添加第一个端点。文件不存在时按空配置启动；**文件存在但内容损坏仍然报错**，不会被静默覆盖。
- 设置页新增**供应商编辑区**：可增删多个 OpenAI 兼容端点、逐个「获取模型列表」（`GET {baseURL}/models`，探测结果不落盘）、从取回的目录里勾选要加入清单的模型。此后按既有规则自动补齐上下文窗口与多模态能力（可手改）。
- **密钥永不回显**：页面只知道「是否已设置」，保存时留空即保持原值。写回的是**原始文档**，所以 `{env:NAME}` 引用逐字保留——写解析后的对象等于用明文替换引用。
- 新增 `ChatProvider.setEndpoint()`，切换端点在同一客户端上原地发生（不重建实例，会话句柄与缓存亲和不受影响）。
- **修复首次保存必定失败**（两处）：配置文件不存在时 `patchConfig` 抛 `missing config`；且 `~/.nova/` 目录不存在时 tmp+rename 落盘失败。二者都只在「干净的第一次运行」出现，正是这个功能的主场景。

### QQ 机器人：`nova --web` 内真正接入

- 此前 `nova --web` 只对凭据做一次连通性测试，**不会实际收发消息**——凭据填好、开关打开，什么都没发生。现在凭据有效且在役时，网关通道在**同一进程内**运行：每个 QQ 对端独立会话，走无人值守审批策略（`never`，与 `nova exec` 一致）。
- **`qqbot` 现在总会出现在插件列表里**：roster 的清单由**候选**构建，而此前通道只在凭据检查通过后才被构造，于是未配置时插件在页面上完全不存在——想开启也无从下手。`qqbot` 属 `advanced`（默认关），仅提供候选不产生任何开销。
- 凭据不可用时给出可执行的说明，而不是让 WebUI 无法启动。

### Skills：改认通用 `.agents` 标准目录

- 发现根按优先级：项目 `.agents/skills` → 项目 `.nova/skills`（向后兼容）→ 用户 `~/.agents/skills` → 用户 `~/.nova/skills`（向后兼容）。此前只扫 `.nova`，因此装在 `~/.agents/skills`（多个 agent 工具共用）的 skill **完全不显示**。
- 除目录包 `<name>/SKILL.md` 外，新增支持扁平 `<name>.md`。
- **修复 YAML 块标量**（`description: >-` / `|`）被读成字面量 `>-` 的缺陷——真实 `.agents` skill 大量使用这种写法（实测 12 个里 8 个），导致描述在索引里变成一串符号。折叠式按 YAML 规则以空格连接，字面式保留换行；缩进行（`metadata:` 的子键）不再被误当顶层键。

### 会话与界面

- **运行中可修改审批等级**。此前有两道锁：服务端拒绝，且设置面板的选择器在整个运行期间被 `modeControlsLocked`（`composerDisabled || !isIdle`）禁用——即使放行服务端也点不动。现在审批档只跟 `composerDisabled` 走，执行模式仍锁（它重建工具集，属缓存前缀）。
- 会话开始后，输入框不再显示模式选择（它只属于 hero 阶段）。
- **修复端点未返回 `usage` 时整条会话统计消失**：`timePill()` 把「N 轮 N 步」这句计数关在「至少量到一个时间量」的门后，而量测来自 provider 的 `usage` 事件——端点忽略 `stream_options.include_usage` 时根本没有 `usage`，于是 `run_stats` 已累加的轮/步被连坐丢弃。现在计数只以 `runs`/`requests` 为门，量测项各自决定在不在；缓存命中信息单独缺席。
- **修复运行中发送的消息可能永远得不到回复**：旧 `runLoop` 先清空 `pending` 再判继续条件，信号一 abort 就把队列**销毁**而非延后——停止后发的消息有日志、有界面，却拿不到它排队换取的那次运行。现在队列由 `PromptQueue` 持有，吸收点唯一（请求真正读到它的那一步），abort 边界换新 controller；插话在**当前运行的下一个步骤边界**即被模型读到，不再等到下一整轮。
- 其余界面修复：展开的过程组被强制套用折叠态间距；连接重试中显示为静态「已断开」图标；子代理摘要字号因误用 `font` 简写变量被静默丢弃；目录选择器把「读取失败」与「空文件夹」显示为同一句话；输入框 `+` 与设置按钮因 UA 按钮内边距而错位；侧边栏收起轨道的图标控件补上提示浮层。

### 目标模式（goal）

- 新增 `create_goal` / `update_goal` 工具与 `/goal` 命令（`/goal` 查看，`/goal clear` 清除）。目标作为**仅落日志**的整份快照（last-write-wins），与 `todo_write` 同构：续接时随 `ready` 恢复，模型不为它付上下文。
- 活跃目标在下一次请求注入一行**临时** user 消息以跨轮继续——复用 job 通知与计划提醒已有的请求级 ephemeral 尾通道（不落日志、每请求重算）。由插件侧产出，core 不需要认识 goal。
- 轮次预算有硬上限：用尽后目标转为 `blocked` 并写明原因，而不是无限继续或静默停下。
- 前端新增目标面板（默认折叠、无目标不渲染），位于计划面板之上。

### 其它

- `SessionEvent` 新增 `goal/change`；`KernelEvent` 新增 `goal`；`ready` 新增可选 `goal`。
- `AgentSession.announceGoal()` 是「记录并广播」目标的唯一门口（`appendEvent` 之后 `publish`），保证「记下了」与「播出去了」不会各走一边。
- **修复结构门禁脚本本身**：`structure-budget.mjs` 的上限计算恒等于「不变或上调」（`Math.min(old, headroomOf(old))` 恒为 `old`），于是任何一次不带子串的 `gates:update` 都会把中间态的行数膨胀**永久烙进上限**，之后长回那个空间门禁不再报红。现在上限始终跟随文件实际行数，缩小会**下调**（本次一次性收紧 12 个文件），增长逐条打印 `RAISED`。
- `pnpm gates` 行数预算已同步；新增文件已登记。
