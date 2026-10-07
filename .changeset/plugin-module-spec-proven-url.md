---
'@nova-agent/plugins': patch
---

`resolveModuleSpec` 对本包自有树上的裸 spec 也改回**已证实的 file URL**（此前只有 app 树这一半这么做了）。裸 spec 假设 Node 在 import 时会重新解析出同一个目标，而只补丁 CJS 解析的 loader（`pnpm dev` 下的 tsx）会打破这个假设：require 从一棵"看似能解析"的树成功，ESM import 却从这里失败——打包进通道包的插件不是本库的依赖，这条路径本来就不该指望宿主的解析。两个分支现在都交还验证过的那个文件，库树、app 树与用户根讲同一个解析故事。直测：`packages/plugins/test/module-spec.test.ts`。
