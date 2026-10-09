---
'@nova-agent/plugins': patch
---

系统提示 persona 从「local coding agent」改为**通用型本地 agent**：Nova 不再把软件工程当作组织整个产品的默认假设，而是它可以可靠执行的一类任务（写作、研究、数据、自动化、编程同等对待）。

**契约未变**：工具使用规则（`read_file` / `search_files` / `list_dir` / `bash`）、`@path` 工作区相对路径语义、子代理规则、安全规则、prompt 前缀的字节稳定性（`<environment>` / `<project_docs>` / `<available_skills>` 注入机制）全部原样保留——只改身份表述与三处泛化措辞（`coding-teammate tone` → 中性；验证规则从"工作区有测试/typecheck/build"泛化为"任务有任何可核结果的方式"；"Leave the workspace in a clean state" → "Leave things in a clean state"）。

方向见 `docs/NOVA-GENERALIST.md` §1 与 G0b。
