/**
 * `render_ui`: the agent's A2UI surface (cards, forms, choices) in the chat.
 *
 * The model writes A2UI v1.0 messages; `parseA2uiMessages` validates them
 * fail-closed in core (component whitelist, caps, JSON-safety), the tool returns
 * a SHORT confirmation to the model, and `presentResult` hands the same messages
 * to the renderer as an `a2ui` result card. The surface lives in the tool's
 * ARGS, which the log already carries — so a reload re-renders it without a
 * second data channel, and the messages never bloat the model-facing result.
 *
 * Human input travels back as an ordinary prompt (the UI formats the resolved
 * action), not through a second broker: the run that asked has usually ended by
 * the time someone clicks, and a form answer is a new user turn in A2UI's own
 * model.
 */
import { parseA2uiMessages, tools as toolsKey, type Plugin } from '@nova-agent/core';
import { registerTool } from '../toolbox.js';

const DESCRIPTION = `Render an interactive A2UI surface (cards, forms, choices) in the user's chat.

Use it when a visual surface is clearer than prose: collecting input with a form, offering options, a summary card, or a confirmation with buttons. Do NOT use it for ordinary text answers or to repeat what your reply already says.

Pass \`messages\` following A2UI v1.0:
1. {"version":"1.0","createSurface":{"surfaceId":"main"}}
2. {"version":"1.0","updateComponents":{"surfaceId":"main","components":[...]}}
3. optional {"version":"1.0","updateDataModel":{"surfaceId":"main","value":{...}}}

Components are a FLAT list; exactly one has id "root". Allowed component values:
Text(text, variant), Row(children), Column(children), Card(child), List(children),
Button(child, variant, action), TextField(label, value), CheckBox(label, value),
ChoicePicker(label, options[{label,value}], value), Slider(label,min,max,value),
DateTimeInput(value, enableDate, enableTime, label), Divider(axis), Image(url),
Icon(name), Tabs(tabs), Modal(trigger, content).

Bind a prop to the data model with {"path":"/field"} (or {"@path":"/field"} in v1.0).
Give a Button an action such as {"event":{"name":"submit","context":{"email":{"path":"/email"}}}}.
When the user clicks, the action name and the resolved field values come back to you as a new user message.`;

const PARAMETERS = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      description: 'A2UI v1.0 messages: createSurface, updateComponents, updateDataModel.',
      items: { type: 'object' },
    },
  },
  required: ['messages'],
  additionalProperties: false,
} as const;

/** The plugin: one tool, always registered (a surface without a renderer falls back to text). */
export function uiPlugin(): Plugin {
  return {
    name: 'render-ui',
    description: 'Let the model render interactive A2UI surfaces in the conversation.',
    manifest: { title: '交互界面', description: '模型用 A2UI 在对话里渲染卡片、表单与按钮。', tier: 'core' },
    inject: [toolsKey],
    apply: (ctx) => {
      registerTool(
        ctx,
        {
          name: 'render_ui',
          description: DESCRIPTION,
          parameters: PARAMETERS,
          execute(args) {
            const messages = parseA2uiMessages(args['messages']);
            if (messages === undefined) {
              return 'Error: messages 不是合法的 A2UI v1.0 消息列表（组件名、引用或长度不合格）。请修正后重试。';
            }
            return `已渲染界面（${String(messages.length)} 条消息）。用户在卡片上的操作会作为下一条消息发回。`;
          },
          // The row is a doorway, not a payload summary: the surface itself is
          // the card body, so the collapsed line just names what it is.
          presentCall() {
            return { card: 'generic', kind: 'other', title: '交互界面' };
          },
          presentResult(args) {
            const messages = parseA2uiMessages(args['messages']);
            return messages === undefined ? undefined : { card: 'a2ui', ok: true, messages };
          },
        },
        // Rendering is not a side effect: the button's eventual action is the
        // user's own prompt, and it passes through the normal permission gate.
        'read',
      );
    },
  };
}
