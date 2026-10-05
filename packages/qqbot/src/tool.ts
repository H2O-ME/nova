/**
 * `qqbot_send`：agent 在对话中主动（被动窗口内）向群/单聊发消息。
 *
 * 定义与插件协议分家（它原本长在 `plugin.ts` 里）：本文件只说**模型能调什么**，
 * 插件怎么装起来在 `plugin.ts`。发送与窗口判定由通道注入，所以这个工具不持有
 * socket，也不会自己决定「现在能不能发」——那只有通道知道。
 */
import type { ToolDefinition } from '@nova-agent/core';

export interface QqBotToolOptions {
  /**
   * Send function (the shared outbox injects it).
   *
   * There is deliberately NO `lastMsgIdOf` here any more: the passive-window rule
   * and the per-message allowance are the OUTBOX's, and a tool that looked up the
   * window itself would be a second copy of that decision — one that could spend
   * the allowance the current turn's answer is holding in reserve. The tool asks to
   * send; the outbox decides whether it may.
   */
  send: (peer: string, content: string, msgId?: string) => Promise<string>;
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
      try {
        return await options.send(peer, content);
      } catch (err) {
        // The refusal is the outbox's own sentence (no window, or the allowance is
        // spent); the model gets it verbatim so it can decide to wait instead.
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
