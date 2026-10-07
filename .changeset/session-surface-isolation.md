---
'@nova-agent/web': patch
'@nova-agent/cli': patch
'@nova-agent/plugins': patch
---

前台会话隔离批：webui 的会话钉住、工作区跟随与标题模型的读取时机。

**webui 订阅被别的 surface 抢走（串台主因）**：内核只有**一个** `current` 会话，QQ 通道每一轮都会 `activate` 它自己绑定的会话。controller 里的钉句柄修复把 `agent` 改成读 `pinnedAgent`，但 `followSession()` 仍在每帧重新 `this.pinnedAgent = this.kernel.agent` —— 于是 QQ 一激活、webui 下一帧（任何帧）就把订阅与「我在服务哪段会话」一起交出去：转录显示别人的会话，下一条提示词也落进别人的会话。现在拆成两件事：`adoptKernelSession()` 只在 webui 自己决定会话时取钉（boot / switch / replace / 工作区移动），`followSession()` 只跟随**钉**，不再回读内核。直测：`packages/web/test/session-isolation.test.ts`「另一个 surface 激活自己的会话不会抢走本 surface」。

**`set_workspace` 作用在别人的会话上**：帧处理器直接调 `kernel.setWorkspace`，而它作用于内核的 `current` —— 那个可能正是 QQ 的会话。于是「webui 换工作区」会把 QQ 的对话改工作区、并在它还是空白时**把它重播种掉**。现在工作区移动是 controller 的方法：先把内核指到本 surface 的钉，再移动，再跟随重播种后的新会话。直测：「工作区移动落在本 surface 的会话上」。

**切换会话不跟随工作区（「跳到其他工作区」）**：一个会话开关有两条路径（活句柄 `activate`、冷句柄 `resume`），而「把工具指到这段会话记录的工作区」只写在了 `resume` 那条上。于是「切走再切回」时转录是本会话、工具根却停在被切走那段会话的目录里。现在抽成 `followWorkspaceOf()`，两条路径共用。直测：「切回活会话会把工作区指回该会话」。

**会话标题模型只在启动时读一次**：`bootKernel` 用 `opts.config.titleModel !== undefined` 决定要不要装 `titleProvider`，而那段注释写的却是「按 SESSION OPEN 读取，不在这里捕获」—— 声明与实现相反。后果是：在设置页（写配置文件）选好标题模型后，**本次进程内新开的会话全都没有标题**（QQ 通道的会话尤其明显，因为那条路径没人会去设置页重设），必须重启才生效。现在 thunk 恒装，是否建客户端由 `createTitleProvider` 在**每次读取时**回答。直测：`packages/cli/test/title-provider.test.ts`（本地假端点，运行期写入 titleModel → 新会话被命名）。

**默认审批档上移 kernel（plugins 半边）**：进程默认档此前住在各 surface 自己的壳里，而会话由**多个** surface 创建——一个 surface 的设置对另一个 surface 开的会话从未生效（「设置了也不执行」）。现在默认档活在 kernel env 上（`approvalDefault` 读活值，缺席回落 boot config 的 `approval`），任何 surface 的设置都能被后开的任何会话读到；档位一经选定仍归属单个会话。同批：`bash` 的审批带上**命令本身**作 preview（只显示工具名的通道不该让人盲批）。
