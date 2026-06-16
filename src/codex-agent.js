import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import WebSocket from 'ws';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function buildCodexArgs({ name, role = name, port, apiUrl, mcpScript }) {
  return [
    'app-server',
    '--listen',
    `ws://127.0.0.1:${port}`,
    '-c',
    'features.multi_agent=false',
    '-c',
    'features.child_agents_md=false',
    '-c',
    'mcp_servers.agent_army.command="node"',
    '-c',
    `mcp_servers.agent_army.args=["${mcpScript}"]`,
    '-c',
    `mcp_servers.agent_army.env={AGENT_ARMY_ROLE="${role}",AGENT_ARMY_AGENT_ID="${name}",AGENT_ARMY_API="${apiUrl}"}`,
  ];
}

export class CodexAgent {
  constructor({ name, role = name, port, apiUrl, cwd, mcpScript, instructions }) {
    this.name = name;
    this.role = role;
    this.port = port;
    this.apiUrl = apiUrl;
    this.cwd = cwd;
    this.mcpScript = mcpScript;
    this.instructions = instructions;
    this.pending = new Map();
    this.nextId = 1;
    this.activeTurn = null;
    this.idleWaiters = [];
  }

  async start() {
    const bin = process.env.CODEX_BIN ?? 'codex';
    const extraArgs = process.env.CODEX_EXTRA_ARGS ? JSON.parse(process.env.CODEX_EXTRA_ARGS) : [];
    this.process = spawn(bin, [...extraArgs, ...buildCodexArgs(this)], {
      cwd: this.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const started = new Promise((resolve, reject) => {
      const onLine = line => {
        if (line.includes('listening on')) resolve();
      };
      createInterface({ input: this.process.stdout }).on('line', onLine);
      createInterface({ input: this.process.stderr }).on('line', onLine);
      this.process.once('error', reject);
      this.process.once('exit', code => {
        if (!this.ws) reject(new Error(`${this.name} app-server exited with ${code}`));
      });
    });
    await Promise.race([started, sleep(30_000).then(() => { throw new Error(`${this.name} app-server timeout`); })]);

    this.ws = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${this.port}`);
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });
    this.ws.on('message', data => this.#dispatch(data.toString()));
    await this.#rpc('initialize', {
      clientInfo: { name: `agent-army-${this.name}`, title: `Agent Army ${this.name}`, version: '0.1.0' },
    });
    this.#notify('initialized');
    const { thread } = await this.#rpc('thread/start', {
      cwd: this.cwd,
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      developerInstructions: this.instructions,
      ephemeral: false,
    });
    this.threadId = thread.id;
    await this.sendTurn('System startup check. Reply with READY only. Do not call tools.');
    return this;
  }

  isBusy() {
    return Boolean(this.activeTurn);
  }

  waitForIdle({ timeoutMs = 5000 } = {}) {
    if (!this.activeTurn) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.idleWaiters = this.idleWaiters.filter(item => item !== waiter);
        reject(new Error(`${this.name} active turn did not stop within ${timeoutMs}ms`));
      }, timeoutMs);
      this.idleWaiters.push(waiter);
    });
  }

  async sendTurn(text) {
    if (this.activeTurn) throw new Error(`${this.name} already has an active turn`);
    return new Promise(async (resolve, reject) => {
      this.activeTurn = { resolve, reject, response: '' };
      try {
        await this.#rpc('turn/start', {
          threadId: this.threadId,
          input: [{ type: 'text', text }],
        });
      } catch (error) {
        this.activeTurn = null;
        reject(error);
        this.#resolveIdleWaiters();
      }
    });
  }

  stop() {
    this.ws?.close();
    this.process?.kill();
  }

  #rpc(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  #notify(method, params = {}) {
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  #dispatch(raw) {
    const message = JSON.parse(raw);
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method !== undefined) {
      this.#answerServerRequest(message);
      return;
    }
    if (message.method === 'item/agentMessage/delta' && this.activeTurn) {
      this.activeTurn.response += message.params?.delta ?? '';
    }
    if (message.method === 'turn/completed' && this.activeTurn) {
      const turn = this.activeTurn;
      this.activeTurn = null;
      turn.resolve(turn.response);
      this.#resolveIdleWaiters();
    }
    if (message.method === 'error' && this.activeTurn) {
      const turn = this.activeTurn;
      this.activeTurn = null;
      turn.reject(new Error(message.params?.error?.message ?? 'Codex turn failed'));
      this.#resolveIdleWaiters();
    }
  }

  #resolveIdleWaiters() {
    for (const waiter of this.idleWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  #answerServerRequest({ id, method, params = {} }) {
    let result = {};
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      result = { decision: 'accept' };
    } else if (method === 'item/permissions/requestApproval') {
      result = { scope: 'session', permissions: params.permissions ?? {} };
    } else if (method === 'mcpServer/elicitation/request') {
      result = { action: 'accept', content: {} };
    } else if (method.toLowerCase().includes('approval')) {
      result = { decision: 'accept' };
    }
    this.ws.send(JSON.stringify({ id, result }));
  }
}
