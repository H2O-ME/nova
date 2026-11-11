# NOVA-WINDOWS.md — Windows 原生桌面端纲领

> 2026-11-12 拍板。本文件是 Windows 原生端的唯一权威文档：产品定位、架构决定、
> 仓库审计与批次表。批次纪律与 `NOVA-GENERALIST.md` 同源：**批准方向 ≠ 批准
> 实现顺序，每批开工前现算依赖**。机制变了就改这里。

## 1. 定位（已拍板）

产品形态参照 Codex 桌面版的**交互范式**，不复制它的产品边界。三个候选
（纯 Codex 桌面版 / Codex+IDE / Codex 交互 + 通用 Agent）中选定第三个，理由：
它与本仓已冻结的通用化定位自洽——编程、研究、写作、自动化都是一等任务类型；
任务列表、执行时间线、按需检查器是交互范式，不是把产品缩成编程工具或 IDE。

继承的既有决定：

- **不新增 Task / Run / Artifact 抽象层**。任务列表只是 Session 的视图投影，
  持久化模型（Session → runAgent → ToolCall → Approval → Session Log）不动。
- 视觉延续 `NOVA-DESIGN-SYSTEM.md` 的既有方向（Quiet / Dense / Neutral），
  落成 XAML ResourceDictionary，不照搬 CSS，也不做玻璃拟态堆叠。

## 2. 架构决定

| 决定项 | 选择 | 一句话理由 |
| --- | --- | --- |
| 桌面 UI | WinUI 3 + C# + XAML（MVVM） | 真原生控件体系；WebView2 不承担主 UI |
| Agent 核心 | 现有 TypeScript 内核**原样复用** | 模型调用/插件/审批生态已建成；重写等于同时做两次迁移 |
| 进程模型 | `Nova.Windows.exe`（UI 宿主）+ node.exe 子进程（Runtime） | UI 与引擎分离；崩溃域隔离 |
| IPC | Named Pipes + 长度前缀 JSON 帧 | 不开 localhost 端口；复用现有帧协议而非另造 |
| 状态权威 | Runtime 唯一事实来源；C# 只存界面偏好 | `Session.appendEvent` 单写者不变，严禁 C# 双写 |
| 用户数据 | `~/.nova/` 一个字节不动 | CLI / Web / 桌面三端共数据；桌面专属状态走 MSIX LocalCache |
| 打包 | MSIX（单项目），Node ≥ 22.19 随包 | 用户无需装 Node；22.19 是 PTC（`stripTypeScriptTypes`）硬要求 |
| 终端 | 首版只做工具输出视图 | 交互终端后议；ConPTY 输入必须命名管道（已有探针结论） |

## 3. 仓库审计（2026-11-12，对照真实源码）

### 3.1 原样复用（零改动）

- `packages/core` 全部：agent 循环、`kernel/session.ts`、approval、
  `presentation.ts`、`user-question.ts`、会话日志 v2（不可变事件流）。
- `packages/ai`、`packages/plugins`、`plugin-subagent` / `plugin-context` / `plugin-ptc`。

### 3.2 适配（小改，都在现有包内）

- `packages/web/src/controller.ts` — 自述 "never touches HTTP or the WS
  handshake; those live in `server.ts`"。唯一传输耦合是 `WsConnection` 类型导入，
  而它本来就是 `send(text)` / `close(code?)` 两方法的结构接口（`ws.ts`）——
  **Named Pipe 连接天然满足**。W2 只需把该接口的归属泛化，控制器本体零改动。
- `packages/web/src/protocol.ts` + `client-frame.ts`（入站不可信输入校验）+
  `wire-limits.ts` — 直接当跨进程契约用，不抽取、不新建协议包。
- `packages/web/src/ws.ts` 的传输法纪照抄进 pipe 传输：1MB 单消息顶、
  8MB 出向缓冲顶（超顶切断而非积压）、断线 = 重连 + replay
  （converge-by-replay 契约已有：attach 先 `ready` 后 live，run 跨掉线存活）。
- `packages/cli/src/web-mode.ts` — 桌面 surface 的装配范本：新增
  `desktopSurface`（同一 `BuiltinSurface` 契约），`surfaces.ts` 注册表加一行；
  boot（provider/模型目录）与 start（起 pipe 服务）分工照抄 web 的分法。
- `packages/web` 内新增 `pipe-server.ts`（与 `server.ts` 平级的传输件）。

### 3.3 新建（Windows 侧）

- `apps/windows/` — .NET 工程，**不进 pnpm workspace**：WinUI 3 壳、MVVM、
  pipe 客户端、MSIX 清单。`dep-direction` 白名单不动（C# 不在扫描面内）。
- Node 运行时打包：`node.exe` + 各包 dist + `node_modules`；
  `node-pty` 原生模块按目标 Node ABI 构建（现居 `packages/web/src/term-session.ts`
  与 `shell-select.ts`，随 runtime 进程走，不在 C# 侧）。

### 3.4 外部方案与仓库现状的修正（以本仓为准）

| 外部方案的说法 | 仓库事实 |
| --- | --- |
| 消费端含 TUI / QQ Bot | TUI 已删；QQ 已迁出为独立产品（`D:\web\noa`）。现存 surface：exec / web / repl + 配置动态行 |
| 新建 `packages/contracts` 或 `surface-protocol` | 不建。`protocol.ts` 已是契约单一来源；C# DTO 手写镜像 + 版本握手即可，一个消费者不值得上 schema codegen |
| 用户数据放 `%LOCALAPPDATA%/Nova`（另一版说 `~/.nova`） | `~/.nova/`，与 AGENTS.md §1 一致；两版冲突以仓规裁决 |
| Node 要求 20+ | 随包运行时取 **22.19+**（PTC 硬要求），不是下限 20 |

## 4. 进程与协议

```
Nova.Windows.exe ──spawn──▶ node.exe（runtime 入口 = nova 的 desktop surface）
        ▲                            │
        └──── Named Pipe（长度前缀 JSON 帧）────┘
```

- 帧格式：4 字节长度前缀 + JSON 文本；一帧一条 ClientFrame / ServerFrame。
- 握手：runtime 起来后先发 `hello { protoVersion }`，版本不匹配即退出；
  UI 侧显式报错而不是静默错配。
- 安全：随机管道名；ACL 限当前用户；入站每一帧过 `client-frame.ts` 校验器
  （它本来就是 untrusted-input 路径）；沿用 `wire-limits` 的全部上限。
- 生命周期：UI 退出 → 向 runtime 发关闭并拒绝未决审批；runtime 崩溃 →
  UI 重启进程并 replay（既有契约，天然成立）。

## 5. 批次表（W 系列）

| 批 | 范围 | 验收 | 止损/门控 |
| --- | --- | --- | --- |
| W0 | 本文档：审计 + 协议决定 + 批次表 | 文档落库 | — |
| W1 | WinUI 3 空壳（导航/任务列表占位/主题）+ 单项目 MSIX 最小打包，**不接 Agent** | 裸 Windows 安装、启动、导航、卸载干净；**量 idle 内存基线** | **止损点**：UI 进程 + runtime 合计与 Electron 教训（419MB）同级则停，先报数再继续 |
| W2 | `desktopSurface` + `pipe-server.ts` + 握手/重连；C# 子进程管理 | 原生窗口完成一次真实流式对话（含工具事件）；杀 runtime 能感知并重启 | W2 开工前现算：controller 泛化面是否真如审计所判 |
| W3 | Codex 交互核心：执行时间线（工具行折叠）、审批/问题卡、任务列表投影、Stop/Continue | 内核主要事件不丢失地承载；持久化日志可完整恢复过程 | — |
| W4 | 检查器与深集成：Diff/Changes、Git、通知、剪贴板、文件选择器、终端决策 | 编程任务与通用任务都有完整的执行—审查—恢复体验 | 交互终端若上局部 WebView2，需单独拍板 |
| W5 | 发行：x64（后续 ARM64）、node-pty 双架构、升级/卸载、Store 资产 | 干净 Windows 无 Node 环境装完即用 | — |

## 6. 风险表

| 风险 | 级别 | 处置 |
| --- | --- | --- |
| node-pty 原生模块 × Node ABI × MSIX | 高 | 固定 Node 发行版；W5 前每批用打包形态真机验证终端路径 |
| C# 维护第二份执行状态 | 高 | **禁止**。C# 只投影事件流；这写进 W3 验收 |
| 协议分叉（两套 ClientFrame 语义） | 高 | **禁止**。契约唯一来源 `protocol.ts`；C# 侧改动必须对照它 |
| 内存超标 | 中 | W1 是量测止损点；选型前先量内存是本仓既有纪律（Electron 419MB 前车之鉴） |
| 插件 UI 扩展 | 中 | 首版只做声明式贡献；C# 永不加载插件 DLL，插件生命周期归 Node |
| `dep-direction` / 棘轮 | 低 | pipe 传输在 `packages/web` 内、装配在 `cli`，白名单不动 |

## 7. 铁律继承（违反即返工）

1. `Session.appendEvent` 是会话日志唯一写入者；C# 不碰会话文件。
2. 审批档位与记忆按会话隔离；桌面端只是 `resolveApproval` 的另一个入口。
3. 工作区目录零写入（数据都在 `~/.nova/`）。
4. 插件故障记录在状态 `error`，绝不崩主进程——runtime 崩了 UI 也不许丢数据。
5. 客户端帧是内核唯一变更通道（prompt / abort / answer / switch），桌面端不开旁路。
