import { AGENT_NAMES } from './agents.js';

const DEFAULT_SUMMARY = '-';
const NOT_STARTED_SUMMARY = 'Not started';

function fallbackType(name) {
  return name.split('-')[0];
}

function compareAgents(left, right) {
  const leftIndex = AGENT_NAMES.indexOf(left);
  const rightIndex = AGENT_NAMES.indexOf(right);
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }
  return left.localeCompare(right);
}

function latestTask(agent) {
  return agent?.tasks?.at(-1) ?? null;
}

export function deriveAgentSummary(agent, name) {
  const task = latestTask(agent);
  if (task?.summary) return task.summary;
  if (task?.title) return task.title;
  if (!agent) return name === 'manager' ? DEFAULT_SUMMARY : NOT_STARTED_SUMMARY;
  return DEFAULT_SUMMARY;
}

export function buildAgentRoster({ run, codexAgents, getStatus }) {
  const runAgents = run?.agents ?? {};
  const names = new Set([...AGENT_NAMES, ...Object.keys(runAgents), ...codexAgents.keys()]);

  return [...names]
    .sort(compareAgents)
    .map(name => {
      const runAgent = runAgents[name];
      const liveAgent = codexAgents.get(name);
      return {
        name,
        status: getStatus(name),
        sessionId: liveAgent?.threadId ?? runAgent?.sessionId ?? '',
        summary: deriveAgentSummary(runAgent, name),
        type: runAgent?.type ?? liveAgent?.role ?? fallbackType(name),
      };
    });
}

export function buildUiState({ run, runFile, codexAgents, getStatus }) {
  return {
    runId: run?.runId ?? '',
    runFile,
    managerStatus: getStatus('manager'),
    agents: buildAgentRoster({ run, codexAgents, getStatus }).map(agent => ({
      name: agent.name,
      status: agent.status,
      sessionId: agent.sessionId,
      summary: agent.summary,
    })),
  };
}
