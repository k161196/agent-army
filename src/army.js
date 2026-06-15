const AGENTS = ['manager', 'brainstorming'];
const STATUSES = new Set(['starting', 'idle', 'working', 'blocked', 'completed', 'failed']);

export class Army {
  constructor({ sendTurn }) {
    this.sendTurn = sendTurn;
    this.agents = new Map(AGENTS.map(name => [name, {
      name,
      status: 'idle',
      messages: [],
      turnQueue: Promise.resolve(),
    }]));
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

  async sendAgentMessage(name, message) {
    const agent = this.#agent(name);
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

  whenIdle() {
    if (!this.managerBusy && !this.userInbox.length && !this.reportInbox.length) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.push(resolve));
  }

  #agent(name) {
    const agent = this.agents.get(name);
    if (!agent) throw new Error(`unknown agent: ${name}`);
    return agent;
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
