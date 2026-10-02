---
'@nova-agent/web': patch
---

为右栏的服务端帧处理器补一份直测车道（`packages/web/test/rightbar-frames.test.ts`，6 用例）：直跑 `handleEntryFrame` / `handleGitFrame`，钉住三条此前只有面板 UI 测试间接触达的契约——

- **写边界即 core 的 `resolveInRoot`**：sidebar 写不能逃工作区；路径穿越在写之前就被拒（`writeTextFile` 抛错、不半写、不回 `entry_saved`）。
- **答复即状态**：写动作回 `entry_saved` / `entry_changed`，stage/commit 回一份新的 `git_status`，不回裸 ok。
- **拒绝是它的帧**：读失败回 `entry_error`；非 git 工作区的 `git_status` 回 `repo: false`——非 git 是答案不是错误。

git 不可用的沙箱自动跳过涉及 git 的用例。
