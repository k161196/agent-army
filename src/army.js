import { AGENT_NAMES } from './agents.js';

const STATUSES = new Set(['not_started', 'starting', 'idle', 'working', 'blocked', 'completed', 'failed', 'closed']);

export class Army {
  constructor({ sendTurn, isAgentActive = () => true }) {
    this.sendTurn = sendTurn;
    this.isAgentActive = isAgentActive;
    this.agents = new Map(AGENT_NAMES.map(name => [name, this.#newAgent(name, {
      type: name,
      initialStatus: name === 'manager' ? 'idle' : 'not_started',
    })]));
    this.managerBusy = false;
    this.userInbox = [];
    this.reportInbox = [];
    this.idleWaiters = [];
  }

  getAgentStatus(name) {
    return this.#agent(name).status;
  }

  listAgentMessages(name) {
    return [...this.#agent(name).messages];
  }

  ensureAgent(name, { type = name, initialStatus = 'not_started' } = {}) {
    if (!this.agents.has(name)) {
      this.agents.set(name, this.#newAgent(name, { type, initialStatus }));
    }
    return this.#agent(name);
  }

  async sendAgentMessage(name, message) {
    const agent = this.#agent(name);
    if (!this.isAgentActive(name)) throw new Error(`agent is not active: ${name}. Spawn it before sending messages.`);
    const run = async () => {
      agent.status = 'working';
      agent.messages.push({ from: 'manager', message });
      try {
        const response = await this.sendTurn(name, message);
        agent.messages.push({ from: name, message: response });
        if (agent.status === 'working') agent.status = 'completed';
        return response;
      } catch (error) {
        agent.status = 'failed';
        throw error;
      }
    };
    const result = agent.turnQueue.then(run, run);
    agent.turnQueue = result.catch(() => {});
    return result;
  }

  sendUserMessage(message) {
    return new Promise((resolve, reject) => {
      this.userInbox.push({ message, resolve, reject });
      this.#drainManager();
    });
  }

  reportStatus(name, status, message) {
    if (!STATUSES.has(status)) throw new Error(`invalid status: ${status}`);
    const agent = this.#agent(name);
    if (name === 'manager') throw new Error('manager cannot report status');
    agent.status = status;
    agent.messages.push({ from: name, status, message });
    this.reportInbox.push({
      message: `[${name} reported ${status}]\n${message}`,
      resolve: () => {},
      reject: () => {},
    });
    this.#drainManager();
    return { ok: true };
  }

  setAgentStatus(name, status) {
    if (!STATUSES.has(status)) throw new Error(`invalid status: ${status}`);
    this.#agent(name).status = status;
  }

  whenIdle() {
    if (!this.managerBusy && !this.userInbox.length && !this.reportInbox.length) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.push(resolve));
  }

  #agent(name) {
    const agent = this.agents.get(name);
    if (!agent) throw new Error(`unknown agent: ${name}`);
    return agent;
  }

  #newAgent(name, { type, initialStatus }) {
    return {
      name,
      type,
      status: initialStatus,
      messages: [],
      turnQueue: Promise.resolve(),
    };
  }

  async #drainManager() {
    if (this.managerBusy) return;
    const item = this.userInbox.shift() ?? this.reportInbox.shift();
    if (!item) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
      return;
    }
    this.managerBusy = true;
    const manager = this.#agent('manager');
    manager.status = 'working';
    manager.messages.push({ from: 'inbox', message: item.message });
    try {
      const response = await this.sendTurn('manager', item.message);
      manager.messages.push({ from: 'manager', message: response });
      manager.status = 'completed';
      item.resolve(response);
    } catch (error) {
      manager.status = 'failed';
      item.reject(error);
    } finally {
      this.managerBusy = false;
      this.#drainManager();
    }
  }
}
