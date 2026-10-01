/**
 * qqbot 在 cli 侧的装配缝：凭据从哪读、surface 怎么包、web 桥怎么起。
 *
 * qqbot 是一档扩展能力，实现在它自己的包里（cli 只经 `loadQqBot` 动态装载，
 * 包缺席即降级）；cli 在这里只做三件事：
 *
 *  1. **凭据端口**：raw 文档的读法（`config-read` / `qqbot-credentials`）。
 *     「`{env:NAME}` 能不能兑现」是配置层的规则，不是那个包的规则，所以读法由
 *     宿主注入——同样一份端口喂给 surface 与 web 桥，两条路径的判定不可能分叉。
 *  2. **内置 surface 包装**：认领（`positional[0] === 'qqbot'`）与启动在 cli
 *     （claim 必须同步可答），产品形态（对端会话编排、启动前置）在包里。装配经
 *     `boot.kernel` 贡献通道插件 + 会话目录 + perRequestCompact，`afterBoot`
 *     回填内核并钉 `never` 策略（无人值守，确定性拒绝，与 exec 同款）。
 *  3. **web 集成**：`nova --web` 进程内的第二条入站通道（设置页保存后拨号），
 *     以及设置页「测试连接」的探针。
 *
 * 包缺席的一切路径都以 `loadQqBot()` 的失败收场：`nova qqbot` 报「扩展不可用」，
 * web 侧整条缝降级（没有桥、没有插件行，原因挂到设置页的诊断面上）。
 */
import type { Kernel } from '@nova-agent/plugins';
import type { Config } from './config.js';
import { qqBotConfigProblem } from './config-read.js';
import { resolvePaint } from './lines.js';
import { loadQqBot, type QqBotBridgeLike, type QqBotCredentialPortLike, type QqBotSurfacePartsLike } from './qqbot-api.js';
import { readQqBotCredentials } from './qqbot-credentials.js';
import type { BuiltinSurface } from './surface-host.js';

/** 包不读 `~/.nova/config.json`：凭据的两个读法由宿主注入（两条路径共用这一份）。 */
export function qqbotCredentialPort(): QqBotCredentialPortLike {
  return {
    credentialsProblem: () => qqBotConfigProblem(),
    readCredentials: () => readQqBotCredentials(),
  };
}

/**
 * `nova qqbot` 的 surface 行：claim 在 cli（argv 形状，同步可答），产品形态在包。
 *
 * 包**迟装载**：注册表构建时只需要 claim，而包的装载是异步的；claimed 之后
 * `boot.kernel` 才真正 `createQqBotSurface(...).prepare()`——缺包时这条命令落在
 * 「扩展不可用」的启动错误上，而不是被别的 surface 悄悄接走。
 * @param config - 壳配置（`ui.theme` 决定 `[qqbot]` 行的调色板）。
 * @returns the built-in row the shell registers.
 */
export function qqbotBuiltinSurface(config: Config): BuiltinSurface {
  const paint = resolvePaint(config.ui?.theme ?? 'dark');
  let parts: QqBotSurfacePartsLike | undefined;

  async function ensureParts(): Promise<QqBotSurfacePartsLike> {
    if (parts !== undefined) return parts;
    const qqbot = await loadQqBot();
    parts = qqbot.createQqBotSurface({
      ...qqbotCredentialPort(),
      // 包只交出一行原文；上色是编排方的呈现（`lines.ts` 的单源调色板）。
      log: (line) => console.log(paint.dim(line)),
    });
    return parts;
  }

  return {
    surface: {
      name: 'qqbot',
      claim: (request) => request.flags.positional[0] === 'qqbot',
      start: async (runtime) => {
        const loaded = await ensureParts();
        await loaded.surface.start(runtime);
      },
    },
    boot: {
      kernel: async () => (await ensureParts()).prepare(),
      afterBoot: (kernel) => {
        const loaded = parts;
        if (loaded === undefined) throw new Error('qqbot：装配前置未运行（boot.kernel 未产出 parts）');
        loaded.attach(kernel);
        // 无人值守：'never' 策略确定性拒绝（连询问器都不派发，exec 同款）。
        kernel.permission.setPolicy('never');
      },
    },
  };
}

/** `nova --web` 进程内的 QQ 桥：通道随进程活，设置页保存后经 seam 拨号。 */
export async function startQqBotWebBridge(kernel: () => Kernel | undefined): Promise<QqBotBridgeLike> {
  const qqbot = await loadQqBot();
  return qqbot.startQqBotBridge(qqbotCredentialPort(), kernel);
}

/**
 * 设置页「测试连接」：拿操作者刚敲的凭据走一次真实往返（token + gateway）。
 *
 * 独立于桥存在与否：桥建不起来（包缺席）时这里也会抛，设置页把原因当答复显示。
 */
export async function testQqBotConnection(opts: { appId: string; clientSecret: string }): Promise<string> {
  return (await loadQqBot()).testQqBotConnection(opts);
}
