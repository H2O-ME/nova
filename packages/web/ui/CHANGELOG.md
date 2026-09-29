# nova-web-ui

## 0.0.1

### Patch Changes

- b21a782: 设置页四版块的可辨认性与引导修复（模型 / 插件管理 / Skill 中心 / QQ 机器人）。
  
  **开关终于看得出开还是关。** 三个版块各画了一套自己的开关，而三套都用「14% 白色叠层」表示开、用「深灰」表示关——暗色下这两个颜色几乎一样，这正是「按钮开关我都看不出是开还是关」。现在统一走共享的 `Switch`：状态只写在 `aria-checked` 上（不再有第二份 `data-on`），外观由这一位驱动，开态是真正的高亮色而不是另一种灰。三份本地的 `.switch` / `.knob` / `.dot` 规则一并删除，只留 `Switch.module.css` 一处定义。
  
  **被拒绝的操作现在说得出原因。** 内核用一条 `error` 帧回答被拒的写入，reducer 把它存进 `manageError`——但此前**没有任何组件渲染过这条消息**，所以「本轮运行中不能切换插件开关」「核心功能不可关闭」以及 QQ 机器人的校验失败全都到不了读者面前：点一下、控件恢复原样、什么也没解释。现在三个受管版块都渲染 `role="alert"` 的横幅，逐字显示内核的理由。`manageError` 是共享通道，而设置面板一次只挂载一个版块，因此归属判据是「我有没有在等这条答复」（`refusalToShow`）：没发过写入的版块不会把上一页的失败画在自己头上。
  
  **开关生效了会明说。** 后端本来就是对的（roster 行转 `active`、工具数组真的多出 `subagent`），缺的是反馈——落定的切换此前一句话都不说，于是「开了 subagent 但 agent 说没有这个工具」无从判断。现在每次落定都给一句话：「已启用「X」，对之后的每一次请求生效。」措辞点明**何时**生效，因为仍在进行的那一轮用的是它开始时定下的工具集。
  
  **三个页面各自解释自己。**
  
  - **模型页**：原本是三个并列的 `<h2>`，看不出它们是一条流水线。现在编号为「第 1 步 供应商 → 第 2 步 模型 → 第 3 步 模型配置」，每步一句产出说明；「能力留空即自动取自 models.dev，填写即覆盖」就写在这一步的说明里。
  - **Skill 中心**：分组只叫「项目级 / 系统级」——那是分类，不是做法。现在每个根的**路径**（`.agents/skills/`、`~/.agents/skills/`）与**条目数**都显示出来，「放错目录」与「没加载」因此可以区分。
  - **QQ 机器人**：原本只有两个凭据输入框，读者无法知道配置它能换来什么。现在列出通道接受的斜杠命令（切换权限档位、审批工具调用、切换模型、切换工作区、切换会话），并把「已配置」拆成三态——未配置 / 已配置但通道未运行 / 运行中。**存了凭据和机器人真的在跑是两件事**，而这正是被报告的那处混淆。状态行是**读数而非控件**，用外壳既有的 `StateDot` 画，不再放一个点了没反应的开关。
  
  **排版对齐。** 供应商页的动作行不再用 `space-between` 把两个按钮推到两端（与上方卡片对不齐，即「ui 错位」）；模型配置卡的卡头改为栅格（1.4 : 1 : auto），输入内容的长度不再挤动旁边的字段；QQ 页的状态行、指引卡沿用设置页既有的行节奏与 `--dsw-*` 令牌，未引入新的间距体系。
  
  服务端仍缺两个字段，本前端已按其到位后的形状写好、缺省时行为不变：`qqbot` 快照的**运行态**标志（前端已在 `qqbot-view.ts` 就地声明为可选 `running`，服务端补上即自动生效）；Skill 的**发现根路径**（目前只用 `level` 区分项目级/系统级，需要每个 skill 行的根目录）。
  
  新增 10 条针对性测试（`settings-feedback.test.tsx`），每条钉住一处上述症状；其中「开关外观」一条经 A/B 验证非空转：把旧的 `data-on` 开关塞回去，它立刻变红。
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [83a875d]
- Updated dependencies [b21a782]
- Updated dependencies [436d7b3]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
- Updated dependencies [b21a782]
  - @nova-agent/core@1.0.0
