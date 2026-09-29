import { tools as toolsKey, type Plugin } from '@nova-agent/core';
import { registerTool } from '@nova-agent/plugins';

/**
 * QQ 机器人插件（第三方插件编写示范）：在宿主的插件容器上注册
 * `qqbot_send` 工具 —— agent 在对话中可主动（被动窗口内）向群/单聊
 * 发送消息。入站消息 → agent 的"大脑"由运行方通过 QqBotRuntime 提供
 * （见 index.ts 的 startQqBot），插件本身不拥有事件循环。
 */

/** 对端标识：`group:<group_openid>` 或 `c2c:<user_openid>`。 */
export type PeerId = string;

export interface QqBotToolOptions {
  /** 发送函数（运行方注入，接 QqApi）。返回回复确认。 */
  send: (peer: PeerId, content: string, msgId?: string) => Promise<string>;
  /** 每个对端最近一条入站 msg_id（被动回复窗口：群 5 分钟 / 单聊 60 分钟）。 */
  lastMsgIdOf: (peer: PeerId) => string | undefined;
}

export function qqbotPlugin(options: QqBotToolOptions): Plugin {
  return {
    name: 'qqbot',
    description: 'QQ bot channel: send messages into groups and direct chats.',
    inject: [toolsKey],
    apply: (ctx) => {
      registerTool(
        ctx,
        {
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
        },
        // 对外发送消息 = 对外网络副作用，与 bash 同级审批。
        'execute',
      );
    },
  };
}
