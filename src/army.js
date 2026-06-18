import { AGENT_NAMES } from './agents.js';

const STATUSES = new Set(['not_started', 'starting', 'idle', 'working', 'blocked', 'awaiting_approval', 'completed', 'failed', 'closed']);

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

  markAgentInterrupted(name) {
    const agent = this.#agent(name);
    agent.intentionalInterrupt = true;
    agent.interruptGeneration += 1;
    agent.messages.push({
      from: 'system',
      event: 'interrupted',
      message: 'Manager interrupted active turn before follow-up.',
    });
  }

  async sendAgentMessage(name, message, { bypassQueueAfterInterrupt = false } = {}) {
    const agent = this.#agent(name);
    if (!this.isAgentActive(name)) throw new Error(`agent is not active: ${name}. Spawn it before sending messages.`);
    const interruptGeneration = agent.interruptGeneration;
    const run = async () => {
      if (!bypassQueueAfterInterrupt && interruptGeneration !== agent.interruptGeneration) {
        throw new Error(`${name} queued message was interrupted before it was sent`);
      }
      agent.status = 'working';
      agent.messages.push({ from: 'manager', message });
      try {
        const response = await this.sendTurn(name, message);
        agent.messages.push({ from: name, message: response });
        agent.intentionalInterrupt = false;
        if (agent.status === 'working') agent.status = 'completed';
        return response;
      } catch (error) {
        if (agent.intentionalInterrupt) {
          agent.intentionalInterrupt = false;
          if (agent.status === 'working') agent.status = 'idle';
        } else {
          agent.status = 'failed';
        }
        throw error;
      }
    };
    const result = bypassQueueAfterInterrupt ? run() : agent.turnQueue.then(run, run);
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
      intentionalInterrupt: false,
      interruptGeneration: 0,
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
