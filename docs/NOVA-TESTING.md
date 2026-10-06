# NOVA 测试规范

> **文档状态**：Normative
> **本文件回答**：什么值得测、测试怎么组织、测试文档怎么写、什么时候清理。
> 命令语义见 `NOVA-0.5.0-REFACTOR.md` §4。

---

## 1. 核心原则

> **Test behavior, not implementation.**

不要把以下当成架构质量指标：

```text
test count
file coverage
function coverage
```

`AGENTS.md` §0.4「拒绝过度测试」在本仓库持续有效：日常验证首选快环，只测不变量、不测具体文案，不写排列组合式、变异式的冗长测试。**本文件不推翻它，本文件定义的是"该测什么"的判据。**

## 2. 四级测试体系

```text
Unit → Integration → Contract → E2E
```

**不是所有功能都需要四层测试。** 多数功能只需要其中一层。

### 2.1 Unit Test 只针对

```text
纯逻辑
高风险算法
复杂状态转换
难以通过边界观察的规则
```

例如：

```text
Event parsing
Permission decision
Retry policy
Session projection
Tool validation
Message transformation
```

**不要为了覆盖率测**：

```text
constructor / getter / setter
trivial wrapper
simple delegation
```

### 2.2 Integration Test

跨模块但仍在单进程内：Session 持久化、Run 生命周期、插件装载与回收、删除序列。

### 2.3 Contract Test

插件**必须主要通过 Contract Test 验证**：

```text
Plugin loads
Capability registered
Capability callable
Permission respected
Failure propagated
Dispose works
```

不要针对每个插件重复测试 Plugin Host 的全部内部实现。

### 2.4 E2E

只测试真正跨边界的用户路径。Web 关键路径：

```text
1. launch
2. create session
3. send prompt
4. receive streaming response
5. tool approval
6. reconnect
```

**不要用 E2E 测每一个 React component。**

## 3. 测试组织

### 3.1 禁止"一文件一测试"

不要默认：

```text
foo.ts + foo.test.ts
bar.ts + bar.test.ts
baz.ts + baz.test.ts
```

测试按 **Domain Behavior** 组织：

```text
test/
├── runtime/
├── session/
├── plugin/
├── protocol/
└── surfaces/
```

> 现有测试目录是按"实现文件"组织的（UI 车道 96 个测试文件、web 车道 31 个）。Batch 9 按域重组，**不是**为了减少文件数，而是让"改一个行为要跑哪些测试"变得可回答。

### 3.2 Contract Test Harness

建立 `packages/core/test-support/`，提供：

```ts
createTestKernel()
createTestPluginHost()
createTestSession()
collectEvents()
runUntilDone()
```

插件共享该 harness。每个插件只测：

```text
通用 Contract + 自身特有行为
```

### 3.3 Test Boundary

测试同样受架构边界管理，见 `NOVA-BOUNDARIES.md` §3.4：

```text
✓  package public API + test-support + contract harness
✓  本包自己的 src/（相对路径）
✗  另一个包的 src/internal/*
```

机器执行：`scripts/test-boundary.mjs`。

## 4. 删除 Implementation-detail Tests

可以删除：

```text
内部 Map 结构测试
内部 Registry size 测试
简单 delegation 测试
纯 wrapper 测试
obsolete adapter 测试
重复 snapshot 测试
```

例如不要：

```ts
expect(serviceStore.services.size).toBe(3)
```

应该测：

```ts
expect(ctx.getService("foo").doSomething()).toEqual(...)
```

> 判据一句话：**如果重构内部 Store 就要大量改测试，那些测试测的是实现。**

## 5. 测试表述纪律

> **不得将"测试全绿"表述为"证明行为未变"。**

测试只能证明**已被测试覆盖的行为**未变。

测试文档禁止声称：

```text
✗ "某个文件被 E2E 覆盖"
✗ "approval.ts is covered"
```

除非测试实际上执行到了该实现。应该描述**行为**：

```text
✓ "tool approval behavior is covered by Web E2E"
```

> 本仓出现过"测试文档声称某文件被 E2E 覆盖，而测试实际重新构建 kernel、根本没经过该文件"的事故。该纪律由此而来。

## 6. Behavior Coverage

可以逐步建立行为覆盖台账：

```yaml
runtime:
  run-lifecycle: [unit, integration]

session:
  persistence: [integration]

plugin:
  lifecycle: [contract]

web:
  streaming: [e2e]
```

**不要**建立：

```yaml
tui-mode.ts: [e2e]
```

测试覆盖的是 **Behavior**，不是文件名。

## 7. 重构期执行方式

**测试治理贯穿全程，不是 Batch 9 才开始的专项。**

| 阶段 | 做什么 |
| --- | --- |
| **Batch 0** | 立规则（本文件）+ 落 `test-boundary` 门禁 |
| **Batch 2–8** | 每批**新测试只测行为**；旧测试**边迁边审**——迁移一个模块时顺手判定它的测试是行为测试还是实现测试 |
| **Batch 9** | Test Consolidation / Final Cleanup：`test-support`、按域重组、删除实现细节测试与 obsolete adapter 测试 |

> **Batch 9 是收口，不是开始。** 如果前 8 批继续积累"旧测试 + 新测试 + 临时兼容"，最后一次性清理必然失控。

## 8. 每批的测试验收口径

```text
快环      pnpm check（lint + gates + --changed 测试）
封板      pnpm verify（build + typecheck + test + gates）
画面      pnpm smoke:web + ZCode 内置浏览器
```

**禁止**：日常跑全量 `pnpm verify`；用 CDP / Playwright 做验证；为了让测试通过而修改测试语义。

**必须**：新增或修改逻辑补 1~3 个覆盖正向流与错误回落的确定性单测；只测不变量。
