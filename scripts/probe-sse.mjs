import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(new URL('../.nova/config.json', import.meta.url), 'utf8'));

const resp = await fetch(`${cfg.provider.baseURL.replace(/\/+$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${cfg.provider.apiKey}`,
  },
  body: JSON.stringify({
    model: cfg.provider.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: 'user', content: '北京现在几点？必须用 get_time 工具查询' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_time',
          description: 'Returns the current date and time.',
          parameters: {
            type: 'object',
            properties: { timezone: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
    ],
  }),
});

console.log('status:', resp.status);
const text = await resp.text();
const lines = text.split('\n').filter((l) => l.startsWith('data:'));
for (const line of lines.slice(-8)) console.log(line.slice(0, 300));
