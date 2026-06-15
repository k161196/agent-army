import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const iso = now => (now instanceof Date ? now : new Date(now)).toISOString();
const safeTime = value => value.replace(/[:.]/g, '-');

export class RunState {
  constructor({ runtimeDir, cwd, config = {}, now = () => new Date(), random = () => Math.random().toString(16).slice(2, 8) }) {
    this.runtimeDir = runtimeDir;
    this.cwd = cwd;
    this.config = config;
    this.now = now;
    this.random = random;
    this.run = null;
    this.runFile = null;
  }

  create() {
    const startedAt = iso(this.now());
    const runId = `${safeTime(startedAt)}-${this.random()}`;
    this.runFile = join(this.runtimeDir, 'runs', `${runId}.json`);
    this.run = {
      runId,
      cwd: this.cwd,
      startedAt,
      endedAt: null,
      config: this.config,
      agents: {},
      completedContexts: [],
      events: [],
    };
    this.persist();
    return this.snapshot();
  }

  static load(file, { now = () => new Date() } = {}) {
    const state = new RunState({ runtimeDir: '', cwd: '', now });
    state.runFile = file;
    state.run = JSON.parse(readFileSync(file, 'utf8'));
    state.runtimeDir = file.split('/runs/')[0] || '';
    state.cwd = state.run.cwd;
    state.config = state.run.config ?? {};
    return state;
  }

  snapshot() {
    return structuredClone(this.run);
  }

  recordSpawn(agent, values) {
    const previous = this.run.agents[agent] ?? { agent, tasks: [] };
    const spawnedAt = iso(this.now());
    this.run.agents[agent] = {
      ...previous,
      agent,
      status: 'active',
      spawnedAt,
      closedAt: null,
      port: values.port,
      threadId: values.threadId,
      sessionId: values.sessionId ?? values.threadId,
      paneRef: values.paneRef ?? previous.paneRef ?? null,
      tasks: previous.tasks ?? [],
      metadata: values.metadata ?? previous.metadata ?? {},
    };
    if (values.task) this.recordAgentTask(agent, values.task);
    this.#event('agent.spawned', agent, { port: values.port, sessionId: values.sessionId ?? values.threadId });
    this.persist();
    return this.run.agents[agent];
  }

  recordAgentTask(agent, task) {
    const record = this.run.agents[agent];
    if (!record) throw new Error(`unknown run agent: ${agent}`);
    const taskId = task.taskId ?? `task-${safeTime(iso(this.now()))}-${this.random()}`;
    const existing = record.tasks.find(item => item.taskId === taskId);
    const value = {
      taskId,
      contextKey: task.contextKey ?? null,
      title: task.title ?? null,
      startedAt: task.startedAt ?? iso(this.now()),
      completedAt: task.completedAt ?? null,
      status: task.status ?? 'working',
      summary: task.summary ?? null,
    };
    if (existing) Object.assign(existing, value);
    else record.tasks.push(value);
    this.persist();
    return value;
  }

  recordClose(agent, { summary, contextKey, title, status = 'completed' } = {}) {
    const record = this.run.agents[agent];
    if (!record) throw new Error(`unknown run agent: ${agent}`);
    const closedAt = iso(this.now());
    record.status = 'closed';
    record.closedAt = closedAt;
    if (summary) {
      const task = record.tasks.at(-1);
      if (task && !task.completedAt) {
        task.completedAt = closedAt;
        task.status = status;
        task.summary = summary;
      }
      this.recordCompletedContext({
        contextKey: contextKey ?? task?.contextKey ?? `${agent}:${record.sessionId}`,
        title: title ?? task?.title ?? `${agent} task`,
        summary,
        agentSessions: [{ agent, sessionId: record.sessionId, threadId: record.threadId }],
      });
    }
    this.#event('agent.closed', agent, { sessionId: record.sessionId });
    this.persist();
    return record;
  }

  recordCompletedContext({ contextKey, title, summary, agentSessions = [] }) {
    const value = {
      contextKey,
      title,
      summary,
      agentSessions,
      updatedAt: iso(this.now()),
    };
    const existing = this.run.completedContexts.find(item => item.contextKey === contextKey);
    if (existing) Object.assign(existing, value);
    else this.run.completedContexts.push(value);
    this.persist();
    return value;
  }

  activeAgents() {
    return Object.fromEntries(Object.entries(this.run.agents)
      .filter(([, agent]) => agent.status === 'active')
      .map(([name, agent]) => [name, {
        port: agent.port,
        threadId: agent.threadId,
        sessionId: agent.sessionId,
        status: agent.status,
        paneRef: agent.paneRef,
      }]));
  }

  persist() {
    mkdirSync(join(this.runtimeDir, 'runs'), { recursive: true });
    writeFileSync(this.runFile, JSON.stringify(this.run, null, 2));
  }

  #event(type, agent, values = {}) {
    this.run.events.push({ time: iso(this.now()), type, agent, ...values });
  }
}
