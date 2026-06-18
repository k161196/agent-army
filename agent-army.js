#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderManagerScreen, startManagerTui } from './src/manager-tui.js';
import { attachInitialAgentPanes, readPanes, syncAgentPanes } from './src/pane-lifecycle.js';
import { runContextCli } from './src/context-cli.js';

const root = dirname(fileURLToPath(import.meta.url));
const runtimeDir = join(homedir(), '.agent-army');
const stateFile = join(runtimeDir, 'state.json');
const panesFile = join(runtimeDir, 'panes.json');
const logFile = join(runtimeDir, 'server.log');
const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith('--')) ?? 'start';
const humanInLoop = !args.includes('--no-human-in-loop');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null);

function alive(state) {
  try {
    process.kill(state.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function request(state, path, value) {
  const response = await fetch(`http://127.0.0.1:${state.apiPort}${path}`, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return text ? JSON.parse(text) : {};
}

async function ensureStarted() {
  let state = readState();
  if (state && alive(state)) return state;

  mkdirSync(runtimeDir, { recursive: true });
  const log = openSync(logFile, 'a');
  const child = spawn(process.execPath, [join(root, 'src', 'runtime-server.js')], {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, AGENT_ARMY_CWD: process.cwd(), HUMAN_IN_LOOP: String(humanInLoop) },
  });
  child.unref();

  for (let attempt = 0; attempt < 300; attempt += 1) {
    await sleep(100);
    state = readState();
    if (state && alive(state)) return state;
  }

  throw new Error(`runtime server failed to start; inspect ${logFile}`);
}

async function interactive(state, { managerOnly = false } = {}) {
  const target = process.env.TMUX_PANE;
  const exec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
  const attachPanes = managerOnly
    ? (s, opts) => attachInitialAgentPanes(s, { ...opts, names: ['manager'] })
    : attachInitialAgentPanes;
  await startManagerTui({
    state,
    request,
    attachInitialAgentPanes: attachPanes,
    syncAgentPanes,
    panesFile,
    target,
    exec,
  });
}

async function attachSession(state, sessionId) {
  const liveState = await request(state, '/health');
  const entry = Object.entries(liveState.agents ?? {}).find(
    ([, a]) => a.threadId === sessionId || a.sessionId === sessionId,
  );
  if (!entry) throw new Error(`no active agent with session ID: ${sessionId} (agent may be closed)`);
  const [name, agent] = entry;
  const bin = process.env.CODEX_BIN ?? 'codex';
  console.log(`Attaching to ${name} (${sessionId})...`);
  execFileSync(bin, ['resume', '--remote', `ws://127.0.0.1:${agent.port}`, agent.threadId], { stdio: 'inherit' });
}


async function printStatus(state) {
  const ui = await request(state, '/ui-state');
  process.stdout.write(renderManagerScreen({ ui, width: process.stdout.columns || 80 }));
}

async function watchStatus(state) {
  const CLEAR_SCREEN = '\x1b[2J\x1b[H';
  const POLL_MS = 750;
  const render = async () => {
    try {
      const ui = await request(state, '/ui-state');
      process.stdout.write(CLEAR_SCREEN);
      process.stdout.write(renderManagerScreen({ ui, width: process.stdout.columns || 80 }));
      process.stdout.write('(Ctrl+C to exit)\n');
    } catch (err) {
      process.stdout.write(CLEAR_SCREEN);
      process.stdout.write(`Error: ${err.message}\n`);
    }
  };
  await render();
  const timer = setInterval(render, POLL_MS);
  await new Promise(resolve => {
    process.on('SIGINT', () => { clearInterval(timer); resolve(); });
    process.on('SIGTERM', () => { clearInterval(timer); resolve(); });
  });
}

if (command === 'context' || command === 'issue') {
  await runContextCli({ cwd: process.cwd(), argv: args });
} else if (command === 'start') {
  await interactive(await ensureStarted());
} else if (command === 'attach') {
  const state = readState();
  if (!state || !alive(state)) throw new Error('Agent Army is not running');
  const subArg = args.filter(a => !a.startsWith('--')).find(a => a !== 'attach');
  const isStatus = args.includes('--status') || subArg === 'status';
  if (isStatus) await watchStatus(state);
  else if (subArg && subArg !== 'status') await attachSession(state, subArg);
  else await interactive(state, { managerOnly: true });
} else if (command === 'status') {
  const state = readState();
  if (!state || !alive(state)) console.log('Agent Army is stopped');
  else await printStatus(state);
} else if (command === 'sessions') {
  const state = readState();
  if (!state || !alive(state)) { console.log('Agent Army is stopped'); process.exit(1); }
  const ui = await request(state, '/ui-state');
  for (const agent of ui.agents ?? []) {
    if (agent.sessionId) console.log(`${agent.name.padEnd(20)} ${agent.sessionId}`);
  }
} else if (command === 'stop') {
  const state = readState();
  if (existsSync(panesFile) && process.env.CMUX_WORKSPACE_ID) {
    const exec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
    const panes = readPanes(panesFile);
    for (const surfaceRef of Object.values(panes)) {
      try {
        exec('cmux', ['close-surface', '--surface', surfaceRef]);
      } catch {
        // Already closed.
      }
    }
  }
  rmSync(panesFile, { force: true });
  if (state && alive(state)) await request(state, '/stop', {});
  console.log('Agent Army stopped');
} else {
  throw new Error(`unknown command: ${command}`);
}
