// Minimal MCP echo server used by client.test.ts: newline-delimited JSON-RPC
// over stdio. Implements initialize, tools/list and tools/call (echo tool).
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg === null || typeof msg !== 'object') return;
  if (msg.method === 'initialize') {
    reply(msg.id, {
      protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'echo', version: '1.0.0' },
    });
  } else if (msg.method === 'notifications/initialized') {
    // notification: no response
  } else if (msg.method === 'tools/list') {
    reply(msg.id, {
      tools: [
        {
          name: 'echo',
          description: 'Echoes the given text',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
          },
        },
      ],
    });
  } else if (msg.method === 'tools/call') {
    reply(msg.id, {
      content: [{ type: 'text', text: `echo:${msg.params?.arguments?.text ?? ''}` }],
      isError: false,
    });
  }
});

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}
