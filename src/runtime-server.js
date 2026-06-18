#!/usr/bin/env node
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_NAMES, isKnownAgentType, isManagerType, promptForType, AGENT_MODELS } from './agents.js';
import { AgentIdAllocator } from './agent-id-allocator.js';
import { buildUiState } from './agent-roster.js';
import { Army } from './army.js';
import { CodexAgent } from './codex-agent.js';
import { attachLifecycleAgentPane, closeLifecycleAgentPane, interruptLifecycleAgentPane } from './pane-lifecycle.js';
import { RunState } from './run-state.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.env.AGENT_ARMY_CWD ?? root;
const runtimeDir = join(cwd, '.agent-army');
const stateFile = join(runtimeDir, 'state.json');
const panesFile = join(runtimeDir, 'panes.json');
const mcpScript = join(root, 'src', 'mcp-server.js');
const codexBin = process.env.CODEX_BIN ?? 'codex';
const sandbox = process.env.AGENT_ARMY_SANDBOX ?? 'workspace-write';
const approvalPolicy = process.env.AGENT_ARMY_APPROVAL_POLICY ?? 'never';
const humanInLoop = process.env.HUMAN_IN_LOOP !== 'false';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const apiPort = await freePort();
const apiUrl = `http://127.0.0.1:${apiPort}`;
const codexAgents = new Map();
const runState = new RunState({
  runtimeDir,
  cwd,
  config: {
    codexBin,
    codexExtraArgs: process.env.CODEX_EXTRA_ARGS?.split(/\s+/).filter(Boolean) ?? [],
    sandbox,
    approvalPolicy,
    agents: AGENT_NAMES,
  },
});
runState.create();

const army = new Army({
  sendTurn: async (name, message) => {
    const agent = codexAgents.get(name);
    if (!agent) throw new Error(`agent process is not active: ${name}`);
    return agent.sendTurn(message);
  },
  isAgentActive: name => codexAgents.has(name),
});

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, apiUrl);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, state());
    if (req.method === 'GET' && url.pathname === '/ui-state') return json(res, 200, uiState());
    if (req.method === 'GET' && url.pathname === '/run') return json(res, 200, runState.snapshot());
    if (req.method === 'GET' && url.pathname === '/contexts') return json(res, 200, runState.snapshot().completedContexts);
    if (req.method === 'POST' && url.pathname === '/contexts') {
      const value = await body(req);
      return json(res, 200, runState.recordCompletedContext(value));
    }
    if (req.method === 'POST' && url.pathname === '/message') {
      const { message } = await body(req);
      return json(res, 200, { response: await army.sendUserMessage(message) });
    }
    const lifecycleMatch = url.pathname.match(/^\/agents\/([^/]+)\/(spawn|close)$/);
    if (lifecycleMatch) {
      const [, name, action] = lifecycleMatch;
      if (req.method === 'POST' && action === 'spawn') return json(res, 200, await spawnAgent(name, await body(req)));
      if (req.method === 'POST' && action === 'close') return json(res, 200, await closeAgent(name, await body(req)));
    }
    const match = url.pathname.match(/^\/agents\/([^/]+)\/(status|messages)$/);
    if (match) {
      const [, name, resource] = match;
      if (req.method === 'GET' && resource === 'status') return json(res, 200, { status: army.getAgentStatus(name) });
      if (req.method === 'GET' && resource === 'messages') return json(res, 200, army.listAgentMessages(name));
      if (req.method === 'POST' && resource === 'messages') {
        const b = await body(req);
        sendAgentMessage(name, b).catch(err => console.error(`[${name}] message error: ${err.message}`));
        return json(res, 200, { ok: true, queued: true });
      }
      if (req.method === 'POST' && resource === 'status') {
        const value = await body(req);
        return json(res, 200, army.reportStatus(name, value.status, value.message));
      }
    }
    if (req.method === 'POST' && url.pathname === '/stop') {
      json(res, 200, { ok: true });
      setTimeout(shutdown, 20);
      return;
    }
    json(res, 404, { error: 'not found' });
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

function state() {
  return {
    pid: process.pid,
    apiPort,
    cwd,
    runId: runState.run.runId,
    runFile: runState.runFile,
    agents: Object.fromEntries([...codexAgents].map(([name, agent]) => [name, {
      agent: name,
      agentId: name,
      type: runState.run.agents[name]?.type ?? agent.role ?? name,
      port: agent.port,
      threadId: agent.threadId,
      sessionId: agent.threadId,
      status: army.getAgentStatus(name),
    }])),
  };
}

function uiState() {
  return buildUiState({
    run: runState.snapshot(),
    runFile: runState.runFile,
    codexAgents,
    getStatus: name => army.getAgentStatus(name),
  });
}

function writeState() {
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state(), null, 2));
}

function syncPaneSpawn(agentId) {
  const target = process.env.TMUX_PANE;
  if (!process.env.CMUX_WORKSPACE_ID && !target) return;
  try {
    attachLifecycleAgentPane(agentId, state(), {
      panesFile,
      target,
      exec: (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 5000 }),
    });
  } catch (error) {
    console.error(`failed to attach pane for ${agentId}: ${error.message}`);
  }
}

function syncPaneClose(agentId) {
  if (!process.env.CMUX_WORKSPACE_ID && !process.env.TMUX_PANE) return;
  try {
    closeLifecycleAgentPane(agentId, {
      panesFile,
      exec: (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 5000 }),
    });
  } catch (error) {
    console.error(`failed to close pane for ${agentId}: ${error.message}`);
  }
}

async function sendAgentMessage(name, { message, interrupt = false } = {}) {
  if (!interrupt || army.getAgentStatus(name) !== 'working') {
    return army.sendAgentMessage(name, message);
  }

  const agent = codexAgents.get(name);
  if (!agent) return army.sendAgentMessage(name, message);
  if (!agent.isBusy()) return army.sendAgentMessage(name, message);

  const interrupted = interruptLifecycleAgentPane(name, {
    panesFile,
    exec: (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 5000 }),
  });
  if (!interrupted.ok) throw new Error(`cannot interrupt ${name}: ${interrupted.reason}`);

  army.markAgentInterrupted(name);
  try {
    await agent.waitForIdle({ timeoutMs: 5000 });
  } catch {
    throw new Error(`interrupt sent to ${name} but active turn did not stop within 5s`);
  }
  return army.sendAgentMessage(name, message, { bypassQueueAfterInterrupt: true });
}

function validateSpawnTarget(type) {
  if (!isKnownAgentType(type)) throw new Error(`unknown agent: ${type}`);
  if (isManagerType(type)) throw new Error('manager is always started by Agent Army');
}

function safeAgentId(type, value) {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) throw new Error(`invalid agent id: ${value}`);
  if (value !== type && !value.startsWith(`${type}-`)) throw new Error(`agent id must start with requested type: ${type}`);
  return value;
}

function knownAgentIds() {
  return new Set([...codexAgents.keys(), ...Object.keys(runState.run.agents)]);
}

const agentIds = new AgentIdAllocator(knownAgentIds);

function codexHomeForType(type) {
  return join(homedir(), '.config', 'agent-army', type);
}

async function startCodexAgent(agentId, type, { metadata = {}, task } = {}) {
  const agent = await new CodexAgent({
    name: agentId,
    role: type,
    port: await freePort(),
    apiUrl,
    cwd,
    mcpScript,
    instructions: promptForType(type, { humanInLoop }),
    codexHome: codexHomeForType(type),
    model: AGENT_MODELS[type],
  }).start();
  codexAgents.set(agentId, agent);
  army.ensureAgent(agentId, { type, initialStatus: 'idle' });
  army.setAgentStatus(agentId, 'idle');
  runState.recordSpawn(agentId, {
    type,
    port: agent.port,
    threadId: agent.threadId,
    sessionId: agent.threadId,
    metadata,
    task,
  });
  syncPaneSpawn(agentId);
  writeState();
  return agent;
}

function resumeContextMessage({ resumeSessionId, contextSummary }) {
  const parts = [];
  if (resumeSessionId) parts.push(`Prior session ID: ${resumeSessionId}`);
  if (contextSummary) parts.push(`Prior context summary: ${contextSummary}`);
  return parts.length ? `Resume context for this fresh Agent thread.\n${parts.join('\n')}` : null;
}

async function spawnAgent(name, values = {}) {
  const type = name;
  validateSpawnTarget(type);
  const agentId = agentIds.reserve(type, values.agentId ? safeAgentId(type, values.agentId) : undefined);
  const task = values.taskId || values.contextKey || values.title ? {
    taskId: values.taskId,
    contextKey: values.contextKey,
    title: values.title,
    status: 'working',
  } : undefined;
  try {
    const agent = await startCodexAgent(agentId, type, {
      metadata: {
        resumeSessionId: values.resumeSessionId ?? null,
        contextSummary: values.contextSummary ?? null,
      },
      task,
    });
    const contextMessage = resumeContextMessage(values);
    if (contextMessage) await army.sendAgentMessage(agentId, contextMessage);
    return {
      agent: type,
      agentId,
      status: army.getAgentStatus(agentId),
      port: agent.port,
      threadId: agent.threadId,
      sessionId: agent.threadId,
      resumedFromSessionId: values.resumeSessionId ?? null,
    };
  } finally {
    agentIds.release(agentId);
  }
}

async function closeAgent(name, values = {}) {
  if (isManagerType(name)) throw new Error('manager cannot be closed while Agent Army is running');
  const agent = codexAgents.get(name);
  if (!agent) throw new Error(`agent is not active: ${name}`);
  syncPaneClose(name);
  agent.stop();
  codexAgents.delete(name);
  army.setAgentStatus(name, 'closed');
  const record = runState.recordClose(name, {
    summary: values.summary,
    contextKey: values.contextKey,
    title: values.title,
    status: values.status ?? 'completed',
  });
  writeState();
  return { agent: name, agentId: name, type: record.type ?? name, status: 'closed', sessionId: record.sessionId };
}

function shutdown() {
  runState.run.endedAt = new Date().toISOString();
  runState.persist();
  for (const agent of codexAgents.values()) agent.stop();
  server.close();
  rmSync(stateFile, { force: true });
  setTimeout(() => process.exit(0), 50);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

mkdirSync(runtimeDir, { recursive: true });
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(apiPort, '127.0.0.1', resolve);
});
await startCodexAgent('manager', 'manager');
writeState();
