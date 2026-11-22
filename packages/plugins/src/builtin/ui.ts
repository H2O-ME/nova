/**
 * `render_ui`: the agent's A2UI surface (cards, forms, choices) in the chat.
 *
 * The model writes A2UI v1.0 messages; `explainA2uiMessages` validates them
 * fail-closed in core (component whitelist, prop enums, caps, JSON-safety) and
 * says WHY when it refuses — the model gets a correctable sentence, not a
 * bare "invalid" that it can only answer by repeating itself. `presentResult`
 * hands the accepted messages
 * to the renderer as an `a2ui` result card. The surface lives in the tool's
 * ARGS, which the log already carries — so a reload re-renders it without a
 * second data channel, and the messages never bloat the model-facing result.
 *
 * Human input travels back as an ordinary prompt (the UI formats the resolved
 * action), not through a second broker: the run that asked has usually ended by
 * the time someone clicks, and a form answer is a new user turn in A2UI's own
 * model.
 */
import { explainA2uiMessages, tools as toolsKey, type Plugin } from '@nova-agent/core';
import { registerTool } from '../toolbox.js';

/**
 * The model sometimes encodes the message list as a JSON string (the arguments
 * are then `{"messages":"[{...}]"}`). Both encodings reach the same fail-closed
 * parser; this adapter is the only tolerance added for it.
 */
function messagesOf(value: unknown): ParsedA2ui {
  const decoded = typeof value !== 'string' ? value : (() => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  })();
  if (decoded === undefined) return { messages: undefined, reason: 'messages 是 JSON 字符串但无法解析' };
  return explainA2uiMessages(decoded);
}

/** Parse result with the reason a retry needs; see `explainA2uiMessages`. */
type ParsedA2ui = ReturnType<typeof explainA2uiMessages>;

const DESCRIPTION = `Render an interactive A2UI surface (cards, forms, choices) in the user's chat.

Use it when a visual surface is clearer than prose: collecting input with a form, offering options, a summary card, or a confirmation with buttons. Do NOT use it for ordinary text answers or to repeat what your reply already says.

Pass \`messages\` as a JSON ARRAY (not a JSON-encoded string) following A2UI v1.0. A complete working call:

[
  {"version":"1.0","createSurface":{"surfaceId":"main","sendDataModel":true}},
  {"version":"1.0","updateComponents":{"surfaceId":"main","components":[
    {"id":"root","component":"Column","children":["title","name","submit"]},
    {"id":"title","component":"Text","text":"差旅报销"},
    {"id":"name","component":"TextField","label":"姓名","value":{"@path":"/name"}},
    {"id":"submit","component":"Button","child":"submit_label","action":{"event":{"name":"submit","context":{"name":{"@path":"/name"}}}}},
    {"id":"submit_label","component":"Text","text":"提交"}
  ]}},
  {"version":"1.0","updateDataModel":{"surfaceId":"main","value":{"name":""}}}
]

Markdown and A2UI are mutually exclusive channels:
- Your ordinary reply text is the ONLY place markdown belongs. Keep prose answers in prose.
- NEVER write A2UI message JSON in your reply text or inside code fences, and never restate the surface's content in prose — once the surface is rendered, it IS the answer.
- Surfaces travel ONLY through this tool. Inside a surface, the Text component's \`text\` prop is the only position that accepts markdown (it renders as rich text); every other prop takes plain values.

Rules the renderer enforces:
- Every component is FLAT: \`id\` + \`component\` (the catalog name, NOT \`type\`). \`child\`/\`children\` hold component ID STRINGS, never inline objects.
- Exactly one component has id "root".
- **The FIRST message must be \`createSurface\` for the surface you then fill.** \`updateComponents\` and \`updateDataModel\` write INTO an existing surface; sending either without its \`createSurface\` in the same call is refused (the processor reports "Surface not found"), and the whole batch is lost. One call = create, place components, set the data model.
- There is NO heading component and no h1/h2/h3: a title is \`Text\` with plain text plus \`weight\` (variant stays "body"). Reaching for markdown heading habits is the single most common rejection.
- Allowed \`component\` values (v1.0 BASIC catalog; the schemas are STRICT — unknown props are rejected): Text(text, variant: body|caption, weight), Row(children, justify, align), Column(children, justify, align), List(children, direction, align; the template form is {"@path":"/items","componentId":"rowTemplate"}), Card(child), Tabs(tabs:[{title, child}]), Modal(trigger, content), Divider(axis: horizontal|vertical), Button(child, variant: default|primary|borderless, action), TextField(label, value, placeholder, variant: shortText|longText|number|obscured, checks), CheckBox(label, value), ChoicePicker(label, options:[{label, value}], value — bind it to a string ARRAY in the data model even for single selection, variant: multipleSelection|mutuallyExclusive, displayStyle: checkbox|chips, filterable), Slider(label, value, max, min, steps), DateTimeInput(label, value: ISO 8601, enableDate, enableTime, min, max), Image(url, description, fit, variant), Icon(name — one of the catalog's icon names, e.g. star/search/close), Video(url), AudioPlayer(url, description).
- Actions live ONLY inside Button's \`action\` prop, which is one of \`{"event":{"name":"...","context":{...}}}\` or \`{"functionCall":{...}}\`. The event's \`name\` is REQUIRED — a bare \`{"event":{"context":{...}}}\` is the most common rejection. No component accepts \`onSubmit\`, \`onClick\`, or a top-level \`redirect\`.
- Interactive components accept \`checks\` (validation rules with inline messages); prefer them over hand-built error text.
- Bind a prop to the data model with {"@path":"/field"}. v1.0 requires the \`@\`; a bare {"path":"/field"} is v0.9 and is refused because the renderer would paint it as a literal object ("[object Object]").
- When the user clicks a Button, its action name and resolved context come back as a new user message.`;

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
            const { messages, reason } = messagesOf(args['messages']);
            if (messages === undefined) {
              // The REASON is the whole point: a model that only hears "invalid"
              // retried five identical payloads in a live run. Naming the
              // component and the prop turns that into one correction.
              return `Error: messages 不是合法的 A2UI v1.0 消息列表 — ${reason ?? '形状不合格'}。请修正后重试。`;
            }
            return `已渲染界面（${String(messages.length)} 条消息）。用户在卡片上的操作会作为下一条消息发回。`;
          },
          // The row is a doorway, not a payload summary: the surface itself is
          // the card body, so the collapsed line just names what it is.
          presentCall() {
            return { card: 'generic', kind: 'other', title: '交互界面' };
          },
          presentResult(args) {
            const { messages } = messagesOf(args['messages']);
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
