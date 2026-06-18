import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentRoster, buildUiState } from '../src/agent-roster.js';

function createRunSnapshot(overrides = {}) {
  return {
    runId: 'run-123',
    agents: {},
    ...overrides,
  };
}

test('buildAgentRoster includes unspawned default specialists', () => {
  const roster = buildAgentRoster({
    run: createRunSnapshot(),
    codexAgents: new Map(),
    getStatus: name => (name === 'manager' ? 'idle' : 'not_started'),
  });

  assert.deepEqual(
    roster.map(agent => [agent.name, agent.status, agent.summary]),
    [
      ['manager', 'idle', '-'],
      ['brainstorming', 'not_started', 'Not started'],
      ['implementation', 'not_started', 'Not started'],
      ['debug', 'not_started', 'Not started'],
      ['tester', 'not_started', 'Not started'],
    ],
  );
});

test('buildAgentRoster includes dynamic agents and prefers latest task summary', () => {
  const roster = buildAgentRoster({
    run: createRunSnapshot({
      agents: {
        debug: {
          type: 'debug',
          status: 'closed',
          sessionId: 'session-debug',
          tasks: [{ title: 'Initial debug task', summary: 'Found the root cause' }],
        },
        'debug-2': {
          type: 'debug',
          status: 'active',
          sessionId: 'session-debug-2',
          tasks: [{ title: 'Second investigation', summary: null }],
        },
      },
    }),
    codexAgents: new Map([
      ['debug-2', { threadId: 'thread-debug-2', role: 'debug' }],
    ]),
    getStatus: name => {
      if (name === 'debug-2') return 'working';
      if (name === 'debug') return 'closed';
      if (name === 'manager') return 'idle';
      return 'not_started';
    },
  });

  assert.deepEqual(
    roster.map(agent => [agent.name, agent.status, agent.sessionId, agent.summary]),
    [
      ['manager', 'idle', '', '-'],
      ['brainstorming', 'not_started', '', 'Not started'],
      ['implementation', 'not_started', '', 'Not started'],
      ['debug', 'closed', 'session-debug', 'Found the root cause'],
      ['tester', 'not_started', '', 'Not started'],
      ['debug-2', 'working', 'thread-debug-2', 'Second investigation'],
    ],
  );
});

test('buildUiState returns manager status and table-ready rows', () => {
  const payload = buildUiState({
    run: createRunSnapshot({ runFile: '/tmp/run.json' }),
    runFile: '/tmp/run.json',
    codexAgents: new Map([
      ['implementation', { threadId: 'thread-impl', role: 'implementation' }],
    ]),
    getStatus: name => {
      if (name === 'manager') return 'working';
      if (name === 'implementation') return 'idle';
      return 'not_started';
    },
  });

  assert.equal(payload.runId, 'run-123');
  assert.equal(payload.runFile, '/tmp/run.json');
  assert.equal(payload.managerStatus, 'working');
  assert.ok(Array.isArray(payload.agents));
  assert.deepEqual(payload.agents.find(agent => agent.name === 'implementation'), {
    name: 'implementation',
    status: 'idle',
    sessionId: 'thread-impl',
    summary: 'Not started',
  });
});
