#!/usr/bin/env node
import { spawn, execSync } from 'child_process';
import WebSocket from 'ws';
import { createInterface } from 'readline';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createServer } from 'http';

const WS_PORT  = 9876;   // codex app-server
const API_PORT = 9877;   // our relay HTTP API
const STATE_FILE = join(homedir(), '.codex', 'agent-army-session.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── state ─────────────────────────────────────────────────────────────────────

function saveState(pid, threadId) {
  writeFileSync(STATE_FILE, JSON.stringify({ pid, threadId, port: WS_PORT, apiPort: API_PORT }));
}
function loadState() {
  if (!existsSync(STATE_FILE)) return null;
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ── server spawn ──────────────────────────────────────────────────────────────

function killPort(port) {
  try { execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' }); } catch {}
}

function startCodexServer() {
  killPort(WS_PORT);
  return new Promise((resolve, reject) => {
    const proc = spawn('codex', ['app-server', '--listen', `ws://127.0.0.1:${WS_PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    proc.unref();
    const onLine = (line) => {
      if (line.includes('listening on')) resolve(proc.pid);
    };
    createInterface({ input: proc.stdout }).on('line', onLine);
    createInterface({ input: proc.stderr }).on('line', onLine);
    proc.once('error', reject);
    setTimeout(() => reject(new Error('codex server timeout')), 30_000);
  });
}

// ── JSON-RPC ──────────────────────────────────────────────────────────────────

let msgId = 1;
const pending = new Map();
let ws;

function rpc(method, params = {}) {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, id, params }));
  });
}
function notify(method, params = {}) {
  ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
}

// ── event bus ─────────────────────────────────────────────────────────────────

const sseClients = new Set();
let onTurnDone = null;

function broadcast(event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(line);
}

const QUIET = new Set([
  'thread/tokenUsage/updated', 'item/reasoning/delta', 'turn/diff/updated',
  'thread/started', 'thread/status/changed', 'remoteControl/status/changed',
  'mcpServer/startupStatus/updated', 'hook/started', 'hook/completed',
  'account/rateLimits/updated', 'deprecationNotice', 'warning',
  'item/started', 'item/completed',
]);

function onNotification(msg) {
  const { method, params = {} } = msg;
  if (QUIET.has(method)) return;

  broadcast(method, params);

  switch (method) {
    case 'turn/started':
      process.stdout.write('\n[agent] ');
      break;
    case 'turn/completed':
      process.stdout.write('\n');
      onTurnDone?.();
      onTurnDone = null;
      break;
    case 'item/agentMessage/delta':
      process.stdout.write(params.delta ?? '');
      break;
    case 'error':
      console.error(`\n[error] ${params.error?.message ?? JSON.stringify(params)}`);
      break;
  }
}

function onServerRequest({ id, method, params = {} }) {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      ws.send(JSON.stringify({ id, result: { decision: 'accept' } }));
      break;
    case 'item/permissions/requestApproval':
      ws.send(JSON.stringify({ id, result: { scope: 'session', permissions: params.permissions ?? {} } }));
      break;
    default:
      ws.send(JSON.stringify({ id, result: {} }));
  }
}

function dispatch(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (process.env.DEBUG) console.error('[raw]', JSON.stringify(msg).slice(0, 200));
  const hasId = msg.id !== undefined, hasMethod = msg.method !== undefined;
  if (hasId && !hasMethod) {
    const cb = pending.get(msg.id); if (!cb) return;
    pending.delete(msg.id);
    msg.error ? cb.reject(new Error(msg.error.message)) : cb.resolve(msg.result);
  } else if (hasId && hasMethod) { onServerRequest(msg); }
  else if (hasMethod) { onNotification(msg); }
}

// ── turn helper ───────────────────────────────────────────────────────────────

let currentThreadId;

async function sendTurn(text) {
  await new Promise(async (resolve, reject) => {
    onTurnDone = resolve;
    try { await rpc('turn/start', { threadId: currentThreadId, input: [{ type: 'text', text }] }); }
    catch (e) { onTurnDone = null; reject(e); }
  });
}

// ── HTTP relay API ────────────────────────────────────────────────────────────
// POST /turn      body: { text: string }   → runs turn, returns 200 when done
// GET  /events    SSE stream of all agent events
// GET  /session   returns session info JSON

function startApiServer() {
  killPort(API_PORT);
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ threadId: currentThreadId, wsPort: WS_PORT, apiPort: API_PORT }));
      return;
    }

    if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(':ok\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'POST' && req.url === '/turn') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', async () => {
        try {
          const { text } = JSON.parse(body);
          if (!text?.trim()) { res.writeHead(400); res.end('missing text'); return; }
          await sendTurn(text);
          res.writeHead(200); res.end('ok');
        } catch (e) {
          res.writeHead(500); res.end(e.message);
        }
      });
      return;
    }

    res.writeHead(404); res.end('not found');
  });
  server.listen(API_PORT, '127.0.0.1', () =>
    console.log(`[api] listening on http://127.0.0.1:${API_PORT}`)
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══ agent-army ═══\n');

  const state = loadState();
  let serverPid;
  let resuming = false;

  if (state && isAlive(state.pid)) {
    console.log(`[resume] server pid ${state.pid}`);
    serverPid = state.pid;
  } else {
    serverPid = await startCodexServer();
    console.log(`[server] pid ${serverPid}`);
    await sleep(500);
  }

  ws = await new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    sock.once('open', () => resolve(sock));
    sock.once('error', reject);
  });

  ws.on('message', data => dispatch(data.toString()));
  ws.on('error', e => console.error('[ws error]', e.message));
  ws.on('close', code => { console.log(`\n[ws] closed (${code})`); process.exit(0); });

  await rpc('initialize', {
    clientInfo: { name: 'agent-army', title: 'Agent Army', version: '0.1.0' },
  });
  notify('initialized');

  // thread IDs don't survive WS disconnect — always create fresh
  const { thread } = await rpc('thread/start', { cwd: process.cwd(), approvalPolicy: 'never' });
  currentThreadId = thread.id;
  saveState(serverPid, currentThreadId);

  startApiServer();

  console.log(`\n┌─ SESSION ──────────────────────────────────────────────────┐`);
  console.log(`│  thread : ${currentThreadId}`);
  console.log(`│  attach : codex resume --remote ws://127.0.0.1:${WS_PORT}`);
  console.log(`│  events : curl -sN http://127.0.0.1:${API_PORT}/events`);
  console.log(`│  send   : curl -s -X POST http://127.0.0.1:${API_PORT}/turn \\`);
  console.log(`│           -H 'Content-Type: application/json' \\`);
  console.log(`│           -d '{"text":"hello"}'`);
  console.log(`└────────────────────────────────────────────────────────────┘\n`);

  await sendTurn('hi');

  // local stdin → agent
  const rl = createInterface({ input: process.stdin });
  const showPrompt = () => process.stdout.write('\n[you] ');
  showPrompt();
  rl.on('line', async (line) => {
    // cursor up 1 (to echoed line) → clear → reprint with prefix
    process.stdout.write(`\x1b[1A\r\x1b[K[you] ${line}\n`);
    if (line.trim()) await sendTurn(line);
    showPrompt();
  });
  rl.on('close', () => ws.close());
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
