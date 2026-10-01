/**
 * 遥控指令的**纯解析器**：QQ 对端发来的一行文本 → 一条意图（或「不是指令」）。
 *
 * 为什么单独一个文件、且不碰任何内核对象：QQ 那边输入的是**文本**，所以「这句话是
 * 指令还是普通提示词」必须是一个可以直接驱动、不用起会话/不用起网络就能穷举的函数。
 * 内核的接缝（权限档、审批、换模型、换工作区、开新会话）在 `remote.ts` 里接线，
 * 这里只负责**认字**。
 *
 * 纪律与前端斜杠菜单完全相同（`ui/src/composer/command-menu.ts`）：认得的 `/name`
 * 当指令走，**认不得的一律原样当提示词发出去**。这条是整个设计的落点——操作者不需要
 * 学两套语法，也不需要担心哪句话被系统吞掉。所以这里刻意**只**认下面的白名单，
 * 且**大小写敏感**（`/Perm` 是普通文本，不是指令）。
 */

/** 权限档位（与内核 `ApprovalMode` 同词汇）。 */
export type RemotePerm = 'read-only' | 'auto-edit' | 'full';

/** 一条认得出的遥控指令。 */
export type RemoteCommand =
  | { kind: 'perm'; mode: RemotePerm }
  | { kind: 'model'; model: string }
  | { kind: 'models' }
  | { kind: 'workspace'; dir?: string }
  | { kind: 'new' }
  | { kind: 'help' }
  | { kind: 'approve'; allow: boolean }
  | { kind: 'status' };

/** 解析结果：要么一条指令，要么（原样）当提示词。 */
export type RemoteParse =
  | { command: RemoteCommand; text?: undefined }
  | { command?: undefined; text: string };

/** The permission tiers a peer may choose, in the order the help text lists them. */
export const REMOTE_PERM_MODES: readonly RemotePerm[] = ['read-only', 'auto-edit', 'full'];

/** 「不是指令」：整行按普通提示词送进会话。 */
function asPrompt(text: string): RemoteParse {
  return { text };
}

/** 一条指令。 */
function asCommand(command: RemoteCommand): RemoteParse {
  return { command };
}

/**
 * Parse one inbound line.
 *
 * Only a line whose FIRST token starts with `/` is ever considered a command;
 * everything else is a prompt. Unknown `/…` names are ALSO returned as prompts
 * (see the module header) — the failure mode of a typo must be "the agent was
 * asked something odd", never "my message vanished".
 * @param raw - the inbound text, verbatim.
 * @returns the command, or the text to send as a prompt.
 */
export function parseRemoteCommand(raw: string): RemoteParse {
  const text = raw.trim();
  if (!text.startsWith('/')) return asPrompt(raw);
  const space = text.search(/\s/u);
  const name = space < 0 ? text : text.slice(0, space);
  const rest = space < 0 ? '' : text.slice(space).trim();
  switch (name) {
    case '/perm':
      return REMOTE_PERM_MODES.includes(rest as RemotePerm)
        ? asCommand({ kind: 'perm', mode: rest as RemotePerm })
        : asPrompt(raw);
    case '/model':
      // An absent id asks a question (list them) rather than being a no-op.
      return rest.length === 0 ? asCommand({ kind: 'models' }) : asCommand({ kind: 'model', model: rest });
    case '/ws':
      // A workspace move with no argument reports where it is; the kernel's
      // `setWorkspace` validates a real path, and guessing one here would hide
      // its refusal.
      return rest.length === 0 ? asCommand({ kind: 'status' }) : asCommand({ kind: 'workspace', dir: rest });
    case '/new':
      return asCommand({ kind: 'new' });
    case '/status':
      return asCommand({ kind: 'status' });
    case '/help':
      return asCommand({ kind: 'help' });
    case '/approve':
    case '/deny':
      return asCommand({ kind: 'approve', allow: name === '/approve' });
    default:
      // An UNKNOWN `/name` is a prompt, matching the composer's rule: the peer's
      // text is never swallowed by a parser that did not understand it.
      return asPrompt(raw);
  }
}
