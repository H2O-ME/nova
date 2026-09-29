/**
 * 插件管理 / Skill 中心 / qqbot 版块的文案。
 *
 * One file per settings section (see `./general.ts`). The plugin inventory's
 * words are the reference's (`ui-settings-plugin-inventory`), with the rows this
 * product words itself marked below.
 */
export const PLUGINS_COPY = {
  'plugins.nav': '插件管理',
  'plugins.title': '插件管理',
  'plugins.intro': '查看运行中的插件、按需开关；开关即时生效并写入配置文件。',
  'plugins.loading': '正在读取插件清单…',
  'plugins.search': '搜索插件',
  'plugins.empty': '暂无插件。',
  'plugins.emptySearch': '无匹配插件',
  /* The three groups the manager draws, on the axis that decides whether a row
     gets a switch at all: `coreGroup` rows are load-bearing and show
     `plugins.locked` in place of one; `standardGroup` ships on but may be turned
     off; `advancedGroup` is OFF until the operator asks for it and each row is
     tagged `plugins.defaultOff`. */
  'plugins.coreGroup': '核心功能',
  'plugins.standardGroup': '基础能力',
  'plugins.advancedGroup': '扩展能力',
  'plugins.locked': '核心功能，不可关闭',
  'plugins.defaultOff': '默认关闭',
  'plugins.on': '已启用',
  'plugins.off': '已关闭',
  'plugins.switching': '切换中…',
  'plugins.switchFailed': '切换失败',
  'plugins.failedCount': '个启动失败',
  'plugins.groupToggle': '展开或收起分组',
  /* Why the switches are locked. The control used to grey out silently, so a
     reader clicking during a live run had no way to learn that the refusal was
     "wait for this turn", not "this row is broken". */
  'plugins.lockNote': '本轮运行中（或与宿主断开）时不能切换插件开关；本轮结束后即可切换。',
  /* The confirmation that a flip LANDED. The row's state word changes too, but a
     reader who just clicked needs a sentence that says the effect is real and
     when it starts — "已启用" alone does not answer "why does the agent still
     say it has no such tool", which is the report this exists to close. */
  'plugins.appliedOn': '已启用「{name}」，对之后的每一次请求生效。',
  'plugins.appliedOff': '已关闭「{name}」，之后的请求不再提供它。',
  /* The refusal banner. Every managed section renders this: a rejection is an
     `error` frame, and until now NOTHING drew its message, so "运行中不能切换"
     and "核心功能不可关闭" were both silent. */
  'manage.errorTitle': '操作未生效',
  /* `plugins.disableConfirm` / `confirmOff` / `confirmCancel` are gone: the
     inventory no longer asks before a flip (the reference's does not either),
     because every switch is reversible in place and a mis-click is one click
     back. The kernel-side tier refusal is the safety net that matters, and it
     answers with a reason. */
  'skills.nav': 'Skill 中心',
  'skills.title': 'Skill 中心',
  'skills.intro': '查看项目级与系统级的全部 Skill；关闭后不再注入后续对话。',
  'skills.loading': '正在读取 Skill 列表…',
  'skills.search': '搜索 Skill',
  'skills.empty': '暂无 Skill。在项目 .agents/skills/ 或 ~/.agents/skills/ 下放置 <名称>/SKILL.md 即可。',
  'skills.emptySearch': '无匹配 Skill',
  'skills.projectGroup': '项目级',
  'skills.userGroup': '系统级',
  /* Where to put a file. The group title alone ("项目级") is a category, not an
     instruction — a reader who wants to add a skill needs the PATH. The
     per-level count lets them tell "I put it in the wrong root" from "it did not
     load". */
  'skills.projectRoot': '.agents/skills/',
  'skills.userRoot': '~/.agents/skills/',
  'skills.rootCount': '{count} 个',
  'skills.hint': 'Skill 正文按需加载：模型命中时调用 skill 工具读取全文。',
  'qqbot.nav': 'QQ 机器人',
  'qqbot.title': 'QQ 机器人',
  'qqbot.intro': '把 nova 接入 QQ：在手机或 QQ 里用斜杠命令遥控本机正在运行的这个 nova。',
  'qqbot.loading': '正在读取连接配置…',
  /* What the channel can actually be told to do. The page used to be two
     credential fields with no statement of purpose, so a reader could not tell
     what configuring it would buy them. */
  'qqbot.guideTitle': '接上之后，可以在 QQ 里这样遥控 nova',
  'qqbot.guidePerm': '切换权限档位（只读 / 可编辑 / 全放行）',
  'qqbot.guideApprove': '审批工具调用：同意、拒绝并附上理由',
  'qqbot.guideModel': '切换模型与推理档位',
  'qqbot.guideWorkspace': '切换工作区目录',
  'qqbot.guideSession': '新建或切换会话',
  'qqbot.statusOn': '已配置',
  'qqbot.statusOff': '未配置',
  /* The three-way reading that replaced the two-way "已配置 / 未配置": stored
     credentials and a LIVE channel are different facts, and the report was about
     a reader who had the first and assumed the second. */
  'qqbot.statusLive': '已连接：本进程正在收发 QQ 消息',
  'qqbot.statusIdle': '已配置，但本进程没有接入（通道未启动）',
  /* The other three answers. A reader who cannot tell these apart is the whole
     complaint: 已关闭 is THEIR switch, 连接中 is a dial in flight, 连接失败 carries
     the host's own reason. */
  'qqbot.stateConnecting': '连接中：已启动，正在与 QQ 网关握手',
  'qqbot.stateFailed': '连接失败',
  'qqbot.stateDisabled': '插件已关闭',
  'qqbot.stateDisabledHint': 'QQ 机器人属于扩展能力，默认关闭。开启后才会注册 qqbot_send 工具，并开始接收 QQ 消息。',
  'qqbot.stateDisabledNote': '开启后这里会显示连接状态、BOT 名称与本次运行的消息计数；凭据也在开启后填写。',
  'qqbot.enable': '开启插件',
  'qqbot.enabling': '开启中…',
  /* The connection-information block: who this bot is and what it has carried.
     The counts' basis is spelled out in the row itself — a process-local counter
     drawn as a running total would be a claim about the past. */
  'qqbot.botName': 'BOT 名称',
  'qqbot.botNameUnknown': '取不到（网关没有返回机器人用户名）',
  'qqbot.botNameUnasked': '通道未运行时取不到',
  'qqbot.countsTerm': '消息统计',
  'qqbot.counts': '本次运行收到 {received} 条 · 已回复 {replied} 条 · {last}',
  'qqbot.lastMessage': '最近一条 {time}',
  'qqbot.noMessages': '还没有收到消息',
  'qqbot.countsScope': '口径：进程内计数，重启后归零，不是历史累计。',
  'qqbot.appId': '应用 ID（appId）',
  'qqbot.appIdPlaceholder': '在 q.qq.com 管理端获取',
  'qqbot.secret': '密钥（clientSecret）',
  'qqbot.secretPlaceholder': '未修改则留空；支持 {env:NAME} 引用',
  'qqbot.secretHint': '留空表示保持已存密钥不变；填 {env:NAME} 则存引用不存明文，加载时展开。',
  'qqbot.secretSet': '已配置（不再显示）',
  'qqbot.secretRef': '引用环境变量',
  'qqbot.secretUnset': '未配置',
  'qqbot.save': '保存',
  'qqbot.saving': '保存中…',
  'qqbot.saved': '已保存',
  'qqbot.test': '测试连接',
  'qqbot.testing': '测试中…',
  'qqbot.testOk': '连接成功',
  'qqbot.testFail': '连接失败',
  /* The line that used to say "实际收发消息由本机 `nova qqbot` 进程承载" was
     the defect, not the copy: an enabled channel plugin must actually run. It
     now says what is true — the bot serves whenever this process is up. */
  'qqbot.liveNote': '凭据有效且插件已启用时，本进程内持续收发行内消息；关闭该插件即停止接入。',
  'qqbot.configError': '该插件当前不可用',
  'pluginState.pending': '等待依赖',
  'pluginState.loading': '加载中',
  'pluginState.active': '运行中',
  'pluginState.failed': '启动失败',
  'pluginState.disposed': '卸载中',
} as const;
