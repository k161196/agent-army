#!/usr/bin/env node
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_NAMES, prompts } from './agents.js';
import { Army } from './army.js';
import { CodexAgent } from './codex-agent.js';
import { RunState } from './run-state.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.env.AGENT_ARMY_CWD ?? root;
const runtimeDir = join(cwd, '.agent-army');
const stateFile = join(runtimeDir, 'state.json');
const mcpScript = join(root, 'src', 'mcp-server.js');
const codexBin = process.env.CODEX_BIN ?? 'codex';
const sandbox = process.env.AGENT_ARMY_SANDBOX ?? 'workspace-write';
const approvalPolicy = process.env.AGENT_ARMY_APPROVAL_POLICY ?? 'never';

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
        const { message } = await body(req);
        return json(res, 200, { response: await army.sendAgentMessage(name, message) });
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
      port: agent.port,
      threadId: agent.threadId,
      sessionId: agent.threadId,
      status: army.getAgentStatus(name),
    }])),
  };
}

function writeState() {
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state(), null, 2));
}

function validateSpawnTarget(name) {
  if (!AGENT_NAMES.includes(name)) throw new Error(`unknown agent: ${name}`);
  if (name === 'manager') throw new Error('manager is always started by Agent Army');
  if (codexAgents.has(name)) throw new Error(`agent is already active: ${name}`);
}

async function startCodexAgent(name, { metadata = {}, task } = {}) {
  const agent = await new CodexAgent({
    name,
    port: await freePort(),
    apiUrl,
    cwd,
    mcpScript,
    instructions: prompts[name],
  }).start();
  codexAgents.set(name, agent);
  army.setAgentStatus(name, 'idle');
  runState.recordSpawn(name, {
    port: agent.port,
    threadId: agent.threadId,
    sessionId: agent.threadId,
    metadata,
    task,
  });
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
  validateSpawnTarget(name);
  const task = values.taskId || values.contextKey || values.title ? {
    taskId: values.taskId,
    contextKey: values.contextKey,
    title: values.title,
    status: 'working',
  } : undefined;
  const agent = await startCodexAgent(name, {
    metadata: {
      resumeSessionId: values.resumeSessionId ?? null,
      contextSummary: values.contextSummary ?? null,
    },
    task,
  });
  const contextMessage = resumeContextMessage(values);
  if (contextMessage) await army.sendAgentMessage(name, contextMessage);
  return {
    agent: name,
    status: army.getAgentStatus(name),
    port: agent.port,
    threadId: agent.threadId,
    sessionId: agent.threadId,
    resumedFromSessionId: values.resumeSessionId ?? null,
  };
}

async function closeAgent(name, values = {}) {
  if (!AGENT_NAMES.includes(name)) throw new Error(`unknown agent: ${name}`);
  if (name === 'manager') throw new Error('manager cannot be closed while Agent Army is running');
  const agent = codexAgents.get(name);
  if (!agent) throw new Error(`agent is not active: ${name}`);
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
  return { agent: name, status: 'closed', sessionId: record.sessionId };
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
await startCodexAgent('manager');
writeState();
