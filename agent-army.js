#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachAgentPanes, refreshPane } from './src/tmux-panes.js';

const root = dirname(fileURLToPath(import.meta.url));
const runtimeDir = join(root, '.agent-army');
const stateFile = join(runtimeDir, 'state.json');
const logFile = join(runtimeDir, 'server.log');
const command = process.argv[2] ?? 'start';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readState = () => existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
const alive = state => {
  try { process.kill(state.pid, 0); return true; } catch { return false; }
};
const request = async (state, path, value) => {
  const response = await fetch(`http://127.0.0.1:${state.apiPort}${path}`, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return text ? JSON.parse(text) : {};
};

async function ensureStarted() {
  let state = readState();
  if (state && alive(state)) return state;
  mkdirSync(runtimeDir, { recursive: true });
  const log = openSync(logFile, 'a');
  const child = spawn(process.execPath, [join(root, 'src', 'runtime-server.js')], {
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, AGENT_ARMY_CWD: process.cwd() },
  });
  child.unref();
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    state = readState();
    if (state && alive(state)) return state;
  }
  throw new Error(`Agent Army failed to start; inspect ${logFile}`);
}

function printState(state) {
  console.log(`Agent Army server: http://127.0.0.1:${state.apiPort}`);
  for (const [name, agent] of Object.entries(state.agents)) {
    const bin = process.env.CODEX_BIN ?? 'codex';
    console.log(`${name}: ${bin} resume --remote ws://127.0.0.1:${agent.port} ${agent.threadId}`);
  }
}

async function interactive(state) {
  printState(state);
  const exec = (command, args) => execFileSync(command, args, { encoding: 'utf8' });
  const panes = attachAgentPanes(state, process.env.TMUX_PANE, exec);
  if (Object.keys(panes).length) console.log('Agent panes refresh after coordinated turns complete.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('[you] ');
  rl.prompt();
  rl.on('line', async line => {
    if (!line.trim()) return rl.prompt();
    try {
      const { response } = await request(state, '/message', { message: line });
      console.log(`\n[manager] ${response}\n`);
      const health = await request(state, '/health');
      if (health.agents?.brainstorming?.status === 'completed') {
        refreshPane('brainstorming', health, panes, exec);
      }
    } catch (error) {
      console.error(error.message);
    }
    rl.prompt();
  });
}

if (command === 'start') {
  interactive(await ensureStarted());
} else if (command === 'attach') {
  const state = readState();
  if (!state || !alive(state)) throw new Error('Agent Army is not running');
  interactive(state);
} else if (command === 'status') {
  const state = readState();
  if (!state || !alive(state)) console.log('Agent Army is stopped');
  else printState(await request(state, '/health'));
} else if (command === 'stop') {
  const state = readState();
  if (state && alive(state)) await request(state, '/stop', {});
  console.log('Agent Army stopped');
} else {
  throw new Error(`unknown command: ${command}`);
}
