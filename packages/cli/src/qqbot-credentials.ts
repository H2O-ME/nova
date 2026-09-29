/**
 * 从 RAW 配置文档里读出**当下可用**的 QQ 凭据。
 *
 * 为什么要单独一个文件、且读原文而不是读 `Config`：`loadConfig` 会跑 `expandDeep`，
 * 拿到的是**启动那一刻**的快照；而设置页会在进程运行中改写 `~/.nova/config.json`。
 * 通道要能在保存后立刻用上新凭据、且不重启，就必须每次连接前重读文件。
 *
 * 读原文的第二个理由与 `config-read.ts` 相同：`{env:NAME}` 引用在展开后就不可复原
 * （展开会把引用换成明文），而这里要判断的正是「这个引用能不能兑现」。
 */
import { docFile, plainMember, readDoc } from './config-doc.js';
import { expandRefs } from './config-expand.js';

/** 一对可用于发请求的凭据。 */
export interface QqBotCredentials {
  appId: string;
  clientSecret: string;
}

/**
 * Read the stored credentials, expanding `{env:NAME}` references.
 *
 * Returns undefined when nothing is stored — including when there is no config
 * file yet, which IS "nothing stored" and is what a first run looks like. That
 * has to be the same answer `qqBotConfigProblem()` gives for the same file (it
 * swallows an unreadable one): the caller asks it first, and two readers
 * disagreeing about one question is how "no credentials" and a crash differ.
 * Throws when a stored reference names an unset variable — that is the case this
 * must NOT swallow, because the operator would then be told the bot is
 * unconfigured instead of being told which variable to set.
 * @param homedir - Override for tests; defaults to the real home.
 * @returns the credentials, or undefined when the `qqbot` block is absent.
 */
export async function readQqBotCredentials(homedir?: string): Promise<QqBotCredentials | undefined> {
  const doc = await readDoc(docFile(homedir)).catch(() => undefined);
  const qqbot = plainMember(doc, 'qqbot');
  if (qqbot === undefined) return undefined;
  const appId = qqbot['appId'];
  const clientSecret = qqbot['clientSecret'];
  if (typeof appId !== 'string' || typeof clientSecret !== 'string') return undefined;
  return { appId: expandRefs(appId), clientSecret: expandRefs(clientSecret) };
}
