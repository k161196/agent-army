#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachAgentPane, attachAgentPanes, closeAgentPane } from './src/tmux-panes.js';

const root = dirname(fileURLToPath(import.meta.url));
const runtimeDir = join(process.cwd(), '.agent-army');
const stateFile = join(runtimeDir, 'state.json');
const panesFile = join(runtimeDir, 'panes.json');
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
  if (state.runFile) console.log(`Run metadata: ${state.runFile}`);
  for (const [name, agent] of Object.entries(state.agents)) {
    console.log(`${name}: ${process.env.CODEX_BIN ?? 'codex'} resume --remote ws://127.0.0.1:${agent.port} ${agent.threadId}`);
  }
}

function writePanes(panes) {
  if (Object.keys(panes).length) writeFileSync(panesFile, JSON.stringify(panes, null, 2));
  else rmSync(panesFile, { force: true });
}

async function syncAgentPanes(state, panes, target, exec) {
  for (const name of Object.keys(panes)) {
    if (!state.agents?.[name]) closeAgentPane(name, panes, exec);
  }
  for (const name of Object.keys(state.agents ?? {})) {
    attachAgentPane(name, state, panes, target, exec);
  }
  writePanes(panes);
}

async function interactive(state) {
  printState(state);
  const exec = (command, args) => execFileSync(command, args, { encoding: 'utf8' });
  const target = process.env.TMUX_PANE;
  const panes = attachAgentPanes(state, target, exec);
  if (Object.keys(panes).length) {
    writePanes(panes);
    console.log('Agent panes refresh after coordinated turns complete.');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('[you] ');
  rl.prompt();
  rl.on('line', async line => {
    if (!line.trim()) return rl.prompt();
    try {
      const { response } = await request(state, '/message', { message: line });
      console.log(`\n[manager] ${response}\n`);
      const health = await request(state, '/health');
      await syncAgentPanes(health, panes, target, exec);
      state = health;
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
  if (existsSync(panesFile) && process.env.CMUX_WORKSPACE_ID) {
    const exec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
    const panes = JSON.parse(readFileSync(panesFile, 'utf8'));
    for (const surfaceRef of Object.values(panes)) {
      try { exec('cmux', ['close-surface', '--surface', surfaceRef]); } catch { /* already closed */ }
    }
    rmSync(panesFile, { force: true });
  }
  if (state && alive(state)) await request(state, '/stop', {});
  console.log('Agent Army stopped');
} else {
  throw new Error(`unknown command: ${command}`);
}
