#!/usr/bin/env node
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Army } from './army.js';
import { CodexAgent } from './codex-agent.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = join(root, '.agent-army');
const stateFile = join(runtimeDir, 'state.json');
const mcpScript = join(root, 'src', 'mcp-server.js');
const cwd = process.env.AGENT_ARMY_CWD ?? root;

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
const ports = { manager: await freePort(), brainstorming: await freePort() };
const apiUrl = `http://127.0.0.1:${apiPort}`;
const codexAgents = new Map();
const prompts = {
  manager: `You are the Manager Agent in a two-agent Agent Army. The only other Agent is the Agent Army MCP brainstorming agent. You MUST delegate every request for brainstorming through the Agent Army MCP send_agent_message tool with agent="brainstorming". Never spawn Codex child agents or sub-agents. Never invent or guess session IDs. Use get_agent_status and list_agent_messages when inspection is needed, then synthesize and return the result.`,
  brainstorming: `You are the Brainstorming Agent. Explore and refine the requested objective. Return a concise, useful result. Before finishing, call report_status with status completed and your result; use blocked if you cannot proceed.`,
};

const army = new Army({
  sendTurn: async (name, message) => codexAgents.get(name).sendTurn(message),
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
    if (req.method === 'POST' && url.pathname === '/message') {
      const { message } = await body(req);
      return json(res, 200, { response: await army.sendUserMessage(message) });
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
    agents: Object.fromEntries([...codexAgents].map(([name, agent]) => [name, {
      port: agent.port,
      threadId: agent.threadId,
      status: army.getAgentStatus(name),
    }])),
  };
}

function shutdown() {
  for (const agent of codexAgents.values()) agent.stop();
  server.close();
  rmSync(stateFile, { force: true });
  setTimeout(() => process.exit(0), 50);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(apiPort, '127.0.0.1', resolve);
});
for (const name of ['manager', 'brainstorming']) {
  const agent = await new CodexAgent({
    name,
    port: ports[name],
    apiUrl,
    cwd,
    mcpScript,
    instructions: prompts[name],
  }).start();
  codexAgents.set(name, agent);
}
mkdirSync(runtimeDir, { recursive: true });
writeFileSync(stateFile, JSON.stringify(state(), null, 2));
