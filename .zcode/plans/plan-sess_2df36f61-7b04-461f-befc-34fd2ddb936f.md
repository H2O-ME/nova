# Nova M6 里程碑：借鉴 deepseek-harness 的六项改进

依据前期对 deepseek-harness（`docs/architecture.md`、`docs/subsystems/*`）与 nova 全部核心源码的调研，按四个阶段落地。每阶段独立可验证，`pnpm verify`（build + typecheck + test）全绿后进入下一阶段。

---

## Phase 1：核心层扩展（packages/core）

### 1.1 `ToolDefinition` 扩展（`packages/core/src/types.ts`）
- 新增可选字段：
  - `timeoutMs?: number` —— 工具级协作超时，由循环统一执行，绝不进入模型 schema（`parameters` 白名单机制不变）。
  - `isConcurrencySafe?: (args: Record<string, unknown>) => boolean` —— 纯同步分类器，只有显式 opt-in 的调用才允许并行。
- `ToolExecuteContext` 增加 `signal` 的组合语义说明；新增可选 `emit?(evt: SessionEvent)`（Phase 2/4 供 todo 工具落日志用）。

### 1.2 循环改造（`packages/core/src/agent.ts`）
- **并行工具执行**：把 `toolCalls` 切成极大连续段——段内所有调用都满足 `isConcurrencySafe(args) === true` 才整段并行（`Promise.allSettled`），否则保持串行。结果与事件仍按原调用顺序产出（并行段先全部 `tool_call_start`，结果逐个落定时发 `tool_call_result`），消息数组顺序确定性不变，前缀缓存不受影响。默认没有任何工具并发安全 → 行为与现状完全一致。
- **通用超时**：`executeTool` 内，若 `tool.timeoutMs` 存在，用 `AbortSignal.any([parent, timerSignal])`（Node ≥20）构造合并信号传入 `ctx.signal`；对不响应 signal 的工具，用 `Promise.race` 兜底返回 `Error: tool timed out after Nms`（注明无法强杀同进程代码）。
- 首批并发标记：`fs-read`（read_file/list_dir）、`get-time` 标 `isConcurrencySafe: () => true`；fs-write/bash/MCP/skill 不标。

### 1.3 token 估价器（新文件 `packages/core/src/estimate.ts`）
- `estimateMessageTokens(msg): number`：CJK 字符按 1 token/字、其它按 4 字符/token 的启发式。
- `estimateNextPromptTokens(anchor: Usage, added: AgentMessage[]): number` = `anchor.promptTokens + Σ estimate(added)` —— 供 cli 做压缩预判。

---

## Phase 2：会话日志重构（不可变日志 + 投影）

### 2.1 事件化 JSONL（`packages/core/src/session.ts`）
- JSONL 升级 v2：每行是一个 `SessionEvent`（`{ type: 'message', message }`、`{ type: 'compaction/start', turn, at }`、`{ type: 'compaction/summary', summary, shadowedTokenCount, ... }`、`{ type: 'compaction/end', turn, error? }`、`{ type: 'todo/write', todos }`、`{ type: 'approval', toolName, kind, outcome, at }`）。compaction/todo/approval 均为 log-only，不进模型消息面。
- **向后兼容**：`replay()` 读 header `v`，v1 裸消息行自动归一化为 message 事件，旧会话 `--resume` 照常工作（v1 文件继续追加 v1 行，避免混写）。
- `Session` 增加 `appendEvent(evt)`（`append(message)` 变为其语法糖）、`deriveMessages(): AgentMessage[]` 投影（应用 compaction 的 surface 替换）、打开时检测**孤儿锁**（有 start 无 end → 警告并视为 stale）。

### 2.2 压缩改为原位事件（`packages/cli/src/compact.ts` 重写）
- `compactSession` 不再新建会话文件，改为在**当前文件**追加三事件：start → 调模型总结 → summary（记录被遮蔽范围与 token 数）→ end（**最后**释放锁，crash 半路可检测）。
- 投影后的消息面与现在产物一致：`[context fragment, 最近 N 条用户消息, 摘要]`，prefix 仍缓存友好；区别是原始日志完整保留，`deriveMessages` 可随时重建。
- `packages/cli/src/tui-mode.ts`、`repl.ts`、`exec.ts`：`messages` 数组成为"投影面"，压缩后按投影重建；`maybeAutoCompact` 与 `/compact` 走新路径；`/session` 状态显示增加日志事件数。

### 2.3 dev 模式不变量
- `tui-mode`/`repl` 在 dev 下断言"投影面 == session.deriveMessages()"（`NOVA_DEBUG` 环境变量开启），防止未来出现旁路状态。

---

## Phase 3：token 锚点 + 压缩预判

- `tui-mode.ts`/`repl.ts` 维护 `usageAnchor`（最近一次成功调用的 `Usage`）与锚点后新增消息列表。
- `agentTurn` 开头（发请求**前**）用 `estimateNextPromptTokens` 预判：超阈值 → 先压缩再调用；调用后的 `maybeAutoCompact` 保留为兜底。状态栏显示"预估"标记。

---

## Phase 4：快赢包 + jobs + todo

### 4.1 审批收紧（`packages/plugins/src/permission.ts`）
- `remembered` 改为 `Map<string, PermissionKind>`，key = `toolName:kind`；
- **bash execute 的 "always" 按命令前缀记**（用户已确认）：解析 `args.command` 取程序名（首个 token，如 `git`、`pnpm`），key = `bash:execute:git`；同前缀放行，其它仍弹审批。fs 写类维持按工具名记。
- fail-closed：`ask` 抛错/挂掉 → 一律 `deny`（dsh 的 `unavailable` 语义）。
- `exec`/非交互模式 → 服务内 `never` 策略短路，不进 ask 链。
- 每次决定写 `approval` 审计事件（经 Phase 2 的 `session.appendEvent`，log-only）。

### 4.2 溢出输出落盘改进（`packages/core/src/agent.ts` storeToolResult）
- 截断标记行追加 retrieval hint：`Use the read tool on this path to view the full output.`
- 落盘路径按会话分组（`cacheDir` 由调用方传 `.nova/cache/tool-outputs/<sessionId>/`），`writeFile` 加 `wx` 排他标志。

### 4.3 jobs 后台任务
- 新文件 `packages/core/src/jobs.ts`（~120 行）：`JobRegistry` —— `JobKindMap { bash: 'bash'; subagent: 'subagent' }`（预留扩展位）、`start()/list()/readOutput(id)/stop(id)`，owner 语义从简（单会话进程内），`done` 在进程资源释放后才 resolve。
- `packages/plugins/src/builtin/bash.ts`：新增 `run_in_background?: boolean` 参数，后台模式下 spawn 后立即注册 job 并返回 `bash-N` 句柄；`readOutput` 游标消费增量输出，`cancel` 同步幂等 kill。
- 新工具 `jobs`（permission: read，参数 `action: 'list'|'output'|'stop'` + `id`）：查询/停止后台任务。v1 为轮询式，无完成主动通知（dsh 的 inbox 注入留作后续扩展点，在 GOALS 记录）。
- `registry` 实例经 `AgentOptions`/`ToolExecuteContext` 下发到 bash 与 jobs 工具。

### 4.4 todo 工具
- 新文件 `packages/plugins/src/builtin/todo.ts`：`todo_write` 工具，整表替换、last-write-wins，条目仅 `{ content, status: 'pending'|'in_progress'|'completed' }`（dsh 教训：故意不给 id/priority）。通过 `ctx.emit` 写 `todo/write` log-only 事件；projection 不进消息面。permission: 'read'（无文件系统副作用）。

---

## 测试计划（沿用 vitest，`packages/*/test/`）

- `core/test/agent.test.ts`：并行段执行顺序、并发安全分类、超时合并信号。
- `core/test/estimate.test.ts`：CJK/ASCII 估价、锚点增量。
- `core/test/session.test.ts`：v2 事件回放、v1 兼容、deriveMessages 投影等价（压缩前后模型可见面 == 旧 compactSession 产物）、孤儿锁检测。
- `cli/test/compact.test.ts`：原位压缩三事件序列。
- `plugins/test/plugins.test.ts`：审批前缀记忆、fail-closed、never 策略、审计事件。
- 新增 `core/test/jobs.test.ts`：启动/输出游标/停止/完成生命周期。
- 新增 `plugins/test/todo.test.ts`：整表替换与事件落盘。

## 文档

- `README.md`：新增 jobs、todo、并行工具、审批粒度、日志 v2 说明；缓存策略一节补充"原位压缩"。
- `docs/GOALS.md`：记录 M6 完成项与遗留扩展点（subagent 复用 JobRegistry、完成通知 inbox 注入、token 逐节点定价）。

## 实施顺序与风险

按 Phase 1 → 2 → 3 → 4 顺序提交；Phase 2 改动面最大（三个 runner 接线），先写投影等价测试再迁移。主要风险：v1/v2 会话兼容与 TUI 对压缩后消息数组的引用——统一走 `deriveMessages()` 重建入口即可消除。