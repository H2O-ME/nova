---
'@nova-agent/plugins': minor
'@nova-agent/cli': minor
---

两项内核执行面差距补齐（对照 ZCode：引擎 vendored 无源码，按其可观察行为与本仓既有机制落地）。

**① bash 工具接入既有的并发分段机制（`isConcurrencySafe`）**：可证明只读的命令与兄弟调用并行执行，其余保持串行。

- **为什么**：模型一批发多个只读命令（`git status` + `git log` + `ls`）此前逐个执行，wall time 被白白拉长；read/list_dir/search 早已声明并行，bash 作为最高频工具却是漏网的最大一块。
- **怎么做**：新增 `bash-readonly.ts` 的 fail-closed 分类器——命令含任何 shell 元字符（`;` `&&` `|` `$` 重定向换行等）、首词不在只读白名单、`git` 子命令不在只读集合、`find` 带写谓词（`-delete`/`-exec` 等）或 `git --output=`，一律判不安全照旧串行；判不了的都串行，所以本次改动**只会放宽并行、不会放宽安全**。写命令（`rm`、`git push`、`pnpm install`）行为零变化。
- **顺带**：`bash.ts` 因新增分类接线超出行数豁免上限，按职责边界把纯字节缓冲 `BudgetedBuffer` 拆到 `bash-buffer.ts`（原本就贴线，这不是为压行数而拆，是字节预算捕获与工具注册两件事各归各位）。直测 3 条钉分类不变量，已做变异验证（破坏元字符检查必须变红）。

**② auto-compact 阈值未配置时按在役端点 `contextWindow` 派生 80%**：`toKernelConfig` 在 `autoCompactTokenLimit` 缺席时读 `resolveProvider(config).contextWindow`，取其 80% 作为边界门阈值（留 20% 容纳一轮工具结果与回复）。

- **为什么**：此前未配置 = 完全禁用自动压缩；配置了也是固定 token 数，换大窗口模型照样提前压缩。ZCode 按窗口余量自动触发，这是内核执行面最实际的一条差距。
- **边界**：显式 `autoCompactTokenLimit` 永远优先；端点未声明窗口（自建网关常见）时维持缺席 = 边界门关，绝不猜；models.dev 的运行时元数据不进这层纯配置投影（无网络）；阈值在装配时定格，中途换模型不跟随。直测 3 条钉派生/优先级/失败回落。
