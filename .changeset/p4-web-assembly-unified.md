---
'@nova-agent/web': minor
'@nova-agent/cli': minor
---

装配合一：WebUI 不再自装内核。`WebController.create` / `launchWeb` 改收**装配好的 `kernel`**（壳经 `cli/kernel-boot.ts` 的 `bootKernel` 装好再交进去），`ControllerOptions` 里与装配相关的字段（`rootDir` / `provider` / `config` / `resumeFile` / `modelCatalog` / `persistConfig` / `extraPlugins` / `surfaces` / `onKernelReady`）连同 controller 内的 `createAgentKernel` 调用一并移除——「未配置端点也要能起」改由壳在装配处用占位 provider 表达。三个装配点收敛为两个（`bootKernel` 服务 exec / repl / qqbot / web；动态 surface 见下一步合流）。第三方若直接使用 `WebController` / `launchWeb`，需自行（或经壳）装配内核后传入。
