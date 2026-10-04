/**
 * `qqbot_send`：agent 在对话中主动（被动窗口内）向群/单聊发消息。
 *
 * 定义与插件协议分家（它原本长在 `plugin.ts` 里）：本文件只说**模型能调什么**，
 * 插件怎么装起来在 `plugin.ts`。发送与窗口判定由通道注入，所以这个工具不持有
 * socket，也不会自己决定「现在能不能发」——那只有通道知道。
 */
import type { ToolDefinition } from '@nova-agent/core';

export interface QqBotToolOptions {
  /** 发送函数（通道注入，接 QqApi）。返回回复确认。 */
  send: (peer: string, content: string, msgId?: string) => Promise<string>;
  /** 每个对端最近一条入站 msg_id（被动回复窗口：群 4.5 分钟 / 单聊 55 分钟）。 */
  lastMsgIdOf: (peer: string) => string | undefined;
}

/** The `qqbot_send` tool, bound to one live channel. */
export function qqbotSendTool(options: QqBotToolOptions): ToolDefinition {
  return {
    name: 'qqbot_send',
    description:
      'Send a text message to a QQ chat. Args: peer (required, "group:<group_openid>" or "c2c:<user_openid>"), ' +
      'content (required). Sending relies on a recent inbound message from that peer (passive-reply window: ' +
      'groups ~5 minutes, DMs ~60 minutes) — if the window expired the send fails and you should wait for ' +
      'the next inbound message instead.',
    parameters: {
      type: 'object',
      properties: {
        peer: { type: 'string', description: 'Target chat: "group:<group_openid>" or "c2c:<user_openid>".' },
        content: { type: 'string', description: 'Plain text content to send.' },
      },
      required: ['peer', 'content'],
      additionalProperties: false,
    },
    async execute(args) {
      const peer = typeof args['peer'] === 'string' ? args['peer'] : '';
      const content = typeof args['content'] === 'string' ? args['content'] : '';
      if (peer.length === 0) return 'Error: peer is required ("group:<id>" or "c2c:<id>")';
      if (content.trim().length === 0) return 'Error: content must be a non-empty string';
      if (!peer.startsWith('group:') && !peer.startsWith('c2c:')) {
        return 'Error: peer must start with "group:" or "c2c:"';
      }
      const msgId = options.lastMsgIdOf(peer);
      if (msgId === undefined) {
        return `Error: no passive-reply window for ${peer} (no recent inbound message). Proactive messages are rate-limited by the platform — wait for the user to message first.`;
      }
      const confirmation = await options.send(peer, content, msgId);
      return `sent to ${peer}: ${confirmation}`;
    },
  };
}
