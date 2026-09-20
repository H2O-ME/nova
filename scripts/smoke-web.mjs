/**
 * Real-machine smoke for `nova --web` (manual harness — NOT part of `pnpm
 * verify`, and it does reach the configured provider for one real tool turn):
 * boots the real CLI process,
 * walks the launch-token → cookie hop, then checks that the *served* bundle is
 * the batch-3 one (the tool-card surface strings are inside it) and that the
 * WebSocket's first frame is a `ready` whose history is a block list.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

const PORT = 7823;
const child = spawn(process.execPath, ['packages/cli/dist/index.mjs', '--web'], {
  cwd: process.cwd(),
  env: { ...process.env, NOVA_WEB_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let err = '';
child.stdout.on('data', (d) => (out += String(d)));
child.stderr.on('data', (d) => (err += String(d)));

async function waitForUrl(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const m = out.match(/http:\/\/127\.0\.0\.1:\d+\/\?t=[A-Za-z0-9_-]+/);
    if (m !== null) return m[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no URL printed in ${timeoutMs}ms; stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  const url = await waitForUrl(15000);
  const token = new URL(url).searchParams.get('t');
  const base = `http://127.0.0.1:${PORT}`;

  const anon = await fetch(`${base}/`, { redirect: 'manual' });
  check('未认证访问 index → 401', anon.status === 401, `status=${anon.status}`);

  const wrong = await fetch(`${base}/?t=nope`, { redirect: 'manual' });
  check('错误 token → 403', wrong.status === 403, `status=${wrong.status}`);

  const hop = await fetch(`${base}/?t=${token}`, { redirect: 'manual' });
  const setCookie = hop.headers.get('set-cookie') ?? '';
  check('正确 token → 302 + HttpOnly cookie', hop.status === 302 && /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie),
    `status=${hop.status} cookie=${setCookie.slice(0, 40)}…`);
  const cookie = setCookie.split(';')[0];

  const index = await fetch(`${base}/`, { headers: { cookie } });
  const html = await index.text();
  check('带 cookie → 200 index.html', index.status === 200 && html.includes('<div id="root">'), `status=${index.status}`);

  const script = /src="([^"]+\.js)"/.exec(html)?.[1];
  const asset = await fetch(`${base}${script}`, { headers: { cookie } });
  const js = await asset.text();
  check('前端 bundle 可取', asset.status === 200 && js.length > 10000, `${script} ${js.length}B`);
  // Batch-3 markers: the card footnotes only exist in the new card-view module,
  // and the sessions/pendingApprovals wire fields only exist in the new protocol.
  // Batch-6 markers: the detail panel, the stats bar and the pagination cursor
  // are strings no earlier bundle could contain.
  const markers = [
    '退出码',
    '结果被截断',
    '改动未完成',
    '搜索文件名',
    'pendingApprovals',
    'list_sessions',
    '关闭详情',
    '加载更早',
    '缓存命中',
    '首 token 平均',
    'load_earlier',
  ];
  const missing = markers.filter((m) => !js.includes(m));
  check('bundle 携带六卡文案 + 批6 详情/统计/分页', missing.length === 0, missing.length > 0 ? `缺少 ${missing.join(', ')}` : markers.length + ' 个标记齐备');

  // Traversal is still refused on the static lane.
  const traversal = await fetch(`${base}/assets/..%2f..%2fpackage.json`, { headers: { cookie }, redirect: 'manual' });
  check('静态托管拒绝穿越', traversal.status === 404 || traversal.status === 400 || traversal.status === 403, `status=${traversal.status}`);

  // WS: cookie-authenticated handshake, first frame must be `ready`.
  const frames = await wsFirstFrames(cookie, 3);
  const ready = frames[0];
  check('WS 101 且首帧 ready', ready?.type === 'ready', `type=${ready?.type ?? 'none'}`);
  if (ready?.type === 'ready') {
    const info = ready.info;
    check('ready.info 携带 history/审批/用量基线',
      Array.isArray(info.history) && Array.isArray(info.pendingApprovals) && typeof info.usedTokens === 'number' && typeof info.approvalMode === 'string',
      `history=${info.history.length} approval=${info.approvalMode} code=${info.codeMode} tokens=${info.usedTokens}`);
    // The replay baseline is paginated: the tail ships, the total is promised.
    check('ready.info 携带分页游标',
      typeof info.historyTotal === 'number' && info.historyTotal >= info.history.length,
      `history=${info.history.length}/${info.historyTotal}`);
  }

  // A real turn that must call a tool: batch 3's claim is that the *host*
  // resolves the card and ships it with the event, so the browser never guesses.
  const turn = await wsTurn(cookie, '用 read_file 读取 package.json 的前 10 行，然后用一句话说明这个仓库是什么。', 120000);
  const starts = turn.filter((f) => f.type === 'event' && f.event.type === 'tool_call_start');
  const resultFrames = turn.filter((f) => f.type === 'event' && f.event.type === 'tool_call_result');
  const cardOf = (id) => resultFrames.find((r) => r.event.call.id === id)?.resultView?.card;
  const cards = starts.map((f) => `${f.event.call.name}:${f.view?.card ?? '无'}→${cardOf(f.event.call.id) ?? '待结果'}`);
  check('工具调用帧随事件携带 view', starts.length > 0 && starts.every((f) => f.view !== undefined),
    `cards=[${cards.join(', ')}]`);
  check('工具结果帧随事件携带 resultView', resultFrames.length > 0 && resultFrames.every((f) => f.resultView !== undefined),
    `results=[${resultFrames.map((f) => f.resultView?.card ?? '无').join(', ')}]`);
  // Batch 6: the detail panel needs the result TEXT, which rides the same frame.
  check('工具结果帧携带详情面板要的原文',
    resultFrames.length > 0 && resultFrames.every((f) => typeof f.event.result?.content === 'string' && f.event.result.content.length > 0),
    `outputs=${resultFrames.map((f) => f.event.result.content.length).join(',')}B`);
  check('本轮有终态', turn.some((f) => f.type === 'event' && (f.event.type === 'done' || f.event.type === 'run_failed')),
    `types=${turn.filter((f) => f.type === 'event').map((f) => f.event.type).slice(-4).join(',')}`);
  // Batch 6: the stats rows are kernel-measured — a real run must report them.
  const stats = turn.find((f) => f.type === 'event' && f.event.type === 'run_stats');
  check('真实轮次产出 run_stats（耗时/首 token/用量）',
    stats !== undefined && stats.event.stats.requests >= 1 && stats.event.stats.durationMs > 0 && stats.event.stats.promptTokens > 0,
    stats === undefined
      ? '无 run_stats 帧'
      : `requests=${stats.event.stats.requests} first=${stats.event.stats.firstTokenMs ?? '未上报'}ms dur=${stats.event.stats.durationMs}ms in=${stats.event.stats.promptTokens} out=${stats.event.stats.completionTokens}`);

  // Batch-3 surface controls, wire level: mode switch, session list, new session.
  const modeFrames = await wsSend(cookie, { type: 'set_approval_mode', mode: 'auto-edit' }, 2);
  const state = modeFrames.find((f) => f.type === 'state');
  check('切换审批档 → state 帧回声', state?.approvalMode === 'auto-edit', `approval=${state?.approvalMode ?? '无 state 帧'}`);

  const listFrames = await wsSend(cookie, { type: 'list_sessions' }, 2);
  const sessions = listFrames.find((f) => f.type === 'sessions');
  check('会话列表帧可取得', Array.isArray(sessions?.items) && sessions.items.length >= 1,
    `items=${sessions?.items?.length ?? '无'} 首项=${JSON.stringify(sessions?.items?.[0] ?? null).slice(0, 100)}`);

  // The attach hop always sends `ready` first — the reply to our frame is the second.
  const newFrames = await wsSend(cookie, { type: 'new_session' }, 2);
  const fresh = newFrames.at(-1);
  check('新建会话 → ready 且转录清空',
    fresh?.type === 'ready' && fresh.info.history.length === 0 && fresh.info.pendingApprovals.length === 0,
    `type=${fresh?.type ?? '无'} history=${fresh?.info?.history?.length ?? '?'}`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exitCode = failed === 0 ? 0 : 1;
} catch (e) {
  console.log(`SMOKE ERROR: ${e.message}`);
  process.exitCode = 1;
} finally {
  child.kill();
}

/** Minimal RFC6455 client: handshake, then decode frames until `n` JSON messages. */
function wsFirstFrames(cookie, n) {
  return wsSession(cookie, (state) => state.messages.length >= n);
}

/** Send one client frame as soon as the socket opens, collect `n` frames back. */
function wsSend(cookie, payload, n) {
  return wsSession(cookie, (state) => state.messages.length >= n, (ws) => {
    ws.write(frame(JSON.stringify(payload)));
  });
}

/** One full turn: send the prompt, collect frames until it reaches a terminal event. */
function wsTurn(cookie, text, maxMs) {
  return wsSession(
    cookie,
    (state) =>
      state.messages.some((m) => m.type === 'event' && (m.event.type === 'done' || m.event.type === 'run_failed' || m.event.type === 'approval_request')) ||
      Date.now() - state.startedAt > maxMs,
    (ws) => {
      ws.write(frame(JSON.stringify({ type: 'prompt', text })));
    },
    maxMs + 5000,
  );
}

function wsSession(cookie, done, onOpen, hardMs = 12000) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64');
    const sock = net.connect(PORT, '127.0.0.1');
    const state = { messages: [], buf: Buffer.alloc(0), sent: 0, lastAt: Date.now(), startedAt: Date.now(), open: false };
    const finish = () => {
      sock.destroy();
      resolve(state.messages);
    };
    const timer = setTimeout(() => {
      if (state.messages.length === 0) reject(new Error('WS produced no frames'));
      else finish();
    }, hardMs);
    sock.on('connect', () => {
      sock.write(
        `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nCookie: ${cookie}\r\n\r\n`,
      );
    });
    sock.on('data', (chunk) => {
      state.buf = Buffer.concat([state.buf, chunk]);
      if (!state.open) {
        const end = state.buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = state.buf.subarray(0, end).toString('latin1');
        if (!/ 101 /.test(head)) {
          clearTimeout(timer);
          sock.destroy();
          reject(new Error(`handshake failed: ${head.split('\r\n')[0]}`));
          return;
        }
        state.open = true;
        state.buf = state.buf.subarray(end + 4);
        if (onOpen !== undefined) onOpen({ write: (f) => { sock.write(f); state.sent += 1; } });
        check('WS 握手接受带 cookie 的连接', true);
      }
      let progressed = true;
      while (progressed && state.buf.length >= 2) {
        progressed = false;
        const len0 = state.buf[1];
        let offset = 2;
        let len = len0 & 0x7f;
        if (len === 126) {
          if (state.buf.length < 4) break;
          len = state.buf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (state.buf.length < 10) break;
          len = Number(state.buf.readBigUInt64BE(2));
          offset = 10;
        }
        if (state.buf.length < offset + len) break;
        const payload = state.buf.subarray(offset, offset + len).toString('utf8');
        state.buf = state.buf.subarray(offset + len);
        state.lastAt = Date.now();
        try {
          state.messages.push(JSON.parse(payload));
        } catch {
          state.messages.push({ type: 'unparseable', payload: payload.slice(0, 80) });
        }
        progressed = true;
      }
      if (done(state)) {
        clearTimeout(timer);
        finish();
      }
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Client frame: masked text, as RFC6455 requires of clients. */
function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}