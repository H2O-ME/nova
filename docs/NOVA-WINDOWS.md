# NOVA-WINDOWS.md — Windows 原生桌面端纲领

> 2026-11-12 拍板。本文件是 Windows 原生端的唯一权威文档：产品定位、架构决定、
> 仓库审计与批次表。批次纪律与 `NOVA-GENERALIST.md` 同源：**批准方向 ≠ 批准
> 实现顺序，每批开工前现算依赖**。机制变了就改这里。

> **2026-11-12 晚终局拍板（取代 WinUI 3 原案）**：「保留现有 React 前端（Codex
> 风格的视觉与交互），用轻量壳做成 Windows 桌面应用。」依据是 W1b 的结构性结论
> （§5.2：内存由渲染引擎决定）——前端确定复用 React WebUI，渲染内存无法回避，
> 宿主就选前端零改动的轻量壳。WinUI 3 工程（`apps/windows/`）保留为性能基准，
> 不再扩大投入；§1–§4 的 WinUI 原案随之降为历史参照（其中 §3.2 的协议复用结论
> 对新路线同样成立且更直接），新路线契约与实测见 §5.3。

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
| W1b | Tauri 2 + React 对比基准（同机同法，`apps/tauri-bench`，已正名 nova-desktop §5.5） | 双形态 60s 基准 + 包体；30min 漂移与 MSIX 路线可补测 | 数据已落 §5.2，**已拍板（§5.3）** |

> **路线改判（2026-11-12 晚）**：终局拍板走「现有 React WebUI + 轻量 Tauri 壳」，
> W2 最小版已完成并真机验证（§5.3）。本表 W2–W5 是 WinUI 原案，降级为备选不排期；
> 其关注点（node-pty ABI、配置化、升级/卸载、Store 资产）对新路线的发行批次
> 同样适用。

### 5.1 W1 实测记录（2026-11-12，本机）

**环境**：Windows 11 家庭版 build 26200（25H2）· .NET SDK 10.0.404 ·
WindowsAppSDK 2.6.5（SelfContained + ReadyToRun，未 trim）· 单项目 MSIX
（`dotnet new winui` 模板）。W1 只验 x64。

**六步验收全过**：

| 步骤 | 结果 |
| --- | --- |
| 签名配置 | 证书驻留 `CurrentUser\My`，csproj 按 thumbprint 引用——仓库内无 PFX 文件、无密码；Subject（CN=AppPublisher）与 `Identity/@Publisher` 是同一份合同，不再各自漂移 |
| 证书信任 | `certutil -addstore TrustedPeople`（一次 UAC 提权；发行期换正式证书） |
| 安装 | `Add-AppxPackage` 成功，`SignatureKind: Developer`，落入 WindowsApps |
| 启动 | 原生 WinUI 3 窗口（NavigationView 骨架，无 WebView2 主 UI）：进程出现 354ms、窗口句柄就绪 1029ms（含 ShellExecute 启动开销） |
| 空闲采样 | 下表：稳定 10s 后连续 60s、每 2s，n=30 |
| 卸载 | `Remove-AppxPackage` 后包与进程零残留 |

**空闲内存基线（MB）**：

| 指标 | min | median | p95 | max |
| --- | --- | --- | --- | --- |
| Working Set（总量） | 114.3 | **114.5** | 118.9 | 120.2 |
| Private Working Set | 27.4 | 27.5 | 30.5 | 43.0 |
| Private Commit | 42.1 | 42.1 | 45.0 | 45.3 |

**包体积**：75.24 MB（SelfContained 含 WinAppSDK 2.6.5 运行时；未 trim）。

**口径诚实性**：Electron 419MB 是当年的任务管理器口径（≈WS 总量）。对比特意用
对 Electron 最有利的「WS 总量」：114.5 vs 419 ≈ **1/3.7**；PWS 口径（27.5MB，
大量共享页来自 WinAppSDK 运行时 DLL）差距更大。**止损判定：通过，W2 的门开了。**

**工具链事实（记下来防止重踩）**：

- `-AllowUnsigned` 对打包桌面应用是死路：`runFullTrust` 是受限能力，两者互斥
  （0x80073D2C「发布者不在未签名的命名空间中」，换 Publisher 无解）。签名
  sideload 是唯一正路。
- 签名证书必须带 Code Signing EKU（`2.5.29.37=1.3.6.1.5.5.7.3.3`），只有
  DigitalSignature 会报 APPX0107「证书不能用于签名」。
- `mspdbcmf.exe` 缺失只影响符号包生成（既有 warning），产物无碍。
- `PublishTrimmed` 暂关：WinUI XAML 反射密集，trim 是 W5 的优化项，不进 W1 基线。

### 5.2 W1b 实测记录：Tauri 2 + React 对比基准（2026-11-12，同机同法）

操作者的三硬指标（低占用 / Agent 前端编程友好 / Codex 级交互）把「宿主与渲染
引擎的内存归属」变成必须实测的题。`apps/tauri-bench`（Tauri 2 + React + Vite，
模板空壳与 Codex 式工作台静态页两个形态），同 W1 口径：稳定 10s → 60s 每 2s
（n=30），**进程树聚合**（主进程 + `--user-data-dir` 指向本应用 `EBWebView` 的
msedgewebview2 实例，命令行标记排除其他应用的实例）。

| 对象 | WS 总量 median | Private Commit median | 进程/窗口就绪 | 包体 |
| --- | --- | --- | --- | --- |
| W1 WinUI 3 空壳 | **114.5** | 42.1 | 354 / 1029ms | 75.24 MB（MSIX 含运行时） |
| Tauri+React 空壳 | 383.4 | 145.8 | 180 / 190ms | 2.05 MiB（MSI） |
| Tauri+React 工作台静态页 | 418.1 | 162.8 | 309 / 538ms | 2.05 MiB |
| Electron（2026-10-06 历史） | ≈419 | 未记录 | — | 150 MB+ |

单位 MB。PWS 列在 zh-CN 计数器实例配对下不可靠，弃用（WS 与 Commit 足以裁决）。

**结构性结论（比数字更重要）**：

- **内存由渲染引擎决定，不由宿主决定。** 任何「React 渲染」方案（Tauri /
  WinUI+WebView2 / Electron）都落在 380–420MB 区间；只有纯原生渲染（WinUI
  XAML）能进 100MB 级。宿主（Rust vs C# vs Node）本身只贡献 10–30MB。
- Tauri 的 2.05 MiB 包体是 WebView2 复用**系统已装**运行时——省的是磁盘，
  不省内存（渲染进程组是本应用专属的）。
- Tauri 窗口句柄就绪 190–538ms 显著快于 WinUI 的 1029ms；但句柄口径 ≠
  webview 内容渲染完成，两值不完全可比，如实记录。
- 工作台静态页比空壳 +34.7MB WS / +17MB Commit——React DOM + CSS 的真实成本。
- 工具链事实：Rust 全量编译 6 分钟；`pnpm workspace` 会拦截非成员目录的
  install（apps/tauri-bench 已入 `pnpm-workspace.yaml`）；Git Bash 传 `/S`
  会被路径转换吃掉，NSIS 静默安装须经 PowerShell `-ArgumentList '/S'`。

**三硬指标对照**：

| 指标 | WinUI 3 | Tauri 2 + React |
| --- | --- | --- |
| 低占用 | ✔ 114.5MB | ✘ 383–418MB ≈ Electron |
| Agent 编程友好 | 中低（XAML/C#） | ✔ React/TS 生态 |
| Codex 级交互 | 可达成 | 可达成 |

**状态：已拍板（2026-11-12 晚）。** 本批数据否定的只是「Tauri 更低占用」的预期，
但拍板反过来用了这个结论——前端确定复用 React WebUI，渲染内存无法回避，宿主就选
前端零改动的轻量壳（§5.3）。30 分钟完整长跑未跑完（短窗内 WS 波动 ≤17MB，漂移可
补测）；MSIX（winapp CLI）打包路线未验。

### 5.3 W2 最小版实测记录：轻量壳 + 现有 WebUI（2026-11-12，本机）

**实现载体**：`apps/tauri-bench`（Tauri 2；crate 已正名 nova-desktop，见 §5.5，
目录名沿用挂账）。壳逻辑约 100 行 Rust（`src-tauri/src/lib.rs`），
`packages/web/ui` 前端零改动。

**壳契约（顺序即依赖）**：

1. spawn `node packages/cli/dist/index.mjs --web`，USERPROFILE 指向隔离 home
   `%TEMP%/nova-desktop-home`（先删后建）——`--web` flag 无 TTY 即 claim，
   空 home 按设计起未配置壳。
2. 逐行读 stdout，按 `Nova WebUI：` 标记解析 launch URL（唯一发现通道，不碰
   内部文件格式；兼容全角冒号）。超时 60s 落错误页。
3. `window.navigate(tauri::Url)` 加载本地 HTTP 服务——WS 协议、cookie 配对、
   端口记忆全部原样保留；Tauri IPC 只管壳功能。
4. `RunEvent::Exit`：kill runtime 子进程 + 删隔离 home。

**真机验证结果**：

| 项 | 结果 |
| --- | --- |
| runtime spawn | node 子进程出现（PID 33564）；隔离 home 创建，真实 `~/.nova/` 零接触 |
| URL 发现与导航 | stdout 标记解析成功，窗口内渲染真实 WebUI |
| WebUI 功能 | hero「今天想做点什么？」+ composer + 工作区（tauri-bench，继承壳 cwd）+ 左下 WS「连接成功」徽标 |
| 退出回收 | WM_CLOSE 关窗 → 壳退出、node 终止、隔离 home 已删除 |

验证方法注记：首屏曾误报「内容异常」，实为 CopyFromScreen 截到遮挡窗口；
PrintWindow / 人眼确认正常。

**挂账（明确不阻塞）**：

- 目录名 `apps/tauri-bench` rename（被会话 shell harness 的 cwd 占用阻塞，
  待收尾/新会话改）。
- 30 分钟长跑漂移、MSIX/NSIS 打包形态。

### 5.4 W2.1 实测记录：接真实 `~/.nova/` 与工作区定案（2026-11-12，本机）

依赖侦查先行（批准方向 ≠ 批准实现顺序，四条都以真实源码为准）：

- **端口并发安全**：`listenWithPreferredPort` 在记忆端口被占时回退临时绑定并
  回写记忆——壳实例与用户浏览器实例可并存，各绑各的端口。
- **cwd 影响面**：`rootDir = path.resolve(process.cwd())`（cli 入口）→ kernel；
  壳 spawn 设 `current_dir` 即控制新会话默认工作区，runtime 零改动。
- **工作区能力 WebUI 已有**：`DirectoryBrowser` 就是工作区选择器的目录浏览器，
  adopt 是内核运行时 re-root（bash/search/fs 工具随行、无需重启 runtime）——
  **壳不做目录选择 UI、不存工作区偏好**。
- **会话目录全局**：会话列表按每条日志记录的 workspace 分组、跨工作区全可见，
  初始 cwd 只影响新会话默认值。

落地（`lib.rs` 约 100 行）：去隔离 home，spawn 直接用用户真实 `~/.nova/`
（配置/会话/配对跨启动保留），cwd = 用户主目录；`RunEvent::Exit` 仍 kill
子进程，不再删任何 home。

**真机验证结果**：

| 项 | 结果 |
| --- | --- |
| 真实 home | portStore 由 5199 → 14349（写入真实 `~/.nova/cache/`）；模型选择显示既有配置（DeepSeek V4 Flash） |
| 会话历史 | 工作区分组（12480 / 下载 / cli / agent）跨工作区全可见 |
| 退出回收 | 关窗 → 壳退出、node 终止；真实 `~/.nova/` 完好，portStore 保留 |

**新挂账**：优雅退通道——runtime 只有 SIGINT/SIGTERM 处理，Windows 上壳→node
只能硬杀；会话日志逐事件落盘，故最多丢进行中的一轮。要优雅退需 runtime 提供
shutdown 通道（HTTP 路由或 console 事件），属 runtime 侧小改，待排。

### 5.5 B 批实测记录：crate 正名与 runtime root 配置化（2026-11-13，本机）

- **crate/包/产物正名** tauri-bench → nova-desktop（`Cargo.toml` package+lib、
  `main.rs`、`package.json`；产物 `target/release/nova-desktop.exe`）。目录名
  `apps/tauri-bench` 沿用挂账：本会话 shell harness 的 cwd 锚在该目录，
  Windows 拒绝 rename，待收尾或新会话改。
- **runtime root 配置化**：`%APPDATA%/com.nova.desktop/nova-desktop.json` 的
  `novaRoot` 字段覆盖，缺省回退开发常量（`DEV_NOVA_ROOT`）。随包内置 runtime
  仍是 W5 的事。
- **真机验证三连**：无配置走默认（进程名已正名 nova-desktop）；坏 root
  （`D:\nonexistent-root`）→ node 秒退 = 覆盖链路真生效；好 root 显式指回
  仓库 → 正常起 + portStore 更新；关窗回收均正常。
- **坑**：Windows PowerShell 5.1 `-Encoding UTF8` 写出带 BOM 的文件，
  `serde_json` 拒收 BOM → 解析失败静默回退默认。壳侧已剥 BOM——真实用户用
  记事本/PS 生成配置会踩同一坑。

### 5.6 优雅退通道（2026-11-13，本机）

- **runtime**：`packages/web/src/server.ts` 新增 `GET /shutdown?t=<token>`——
  launch token 就是 bearer 凭据（与 cookie 配对同源）；分支必须放在 launch hop
  **之前**（否则任何带 `?t=` 的请求先被它 302）；关闭动作复用 `handle.close()`
  单一实现（先 dispose 再切 socket），不造第二份。
- **壳**：`RunEvent::Exit` 先 TCP GET `/shutdown`（std::net 手写，零新依赖）→
  最多等 3s → kill 兜底。runtime 自己 dispose jobs/PTY。
- **测试**：`server.test.ts` 两个专项（坏 token → 403 且继续服务；好 token →
  200 + 端口关闭 + dispose 恰一次），stub controller 独立 rig，不碰共享
  handle。13/13 过。
- **真机验证**：独立 `node --web` → GET /shutdown → node 自行退出；壳关窗 →
  壳/runtime 双双退出，全系统无 `index.mjs --web` 残留（谱系追踪 + 全局清点）。
- **教训**：改 `packages/web` 必须重建 dist（`pnpm --filter @nova-agent/web
  build && pnpm --filter @nova-agent/cli build`）——runtime 跑的是 dist；旧
  产物下验证的第一轮被 launch hop 302 回主页，差点误判路由没生效。

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
