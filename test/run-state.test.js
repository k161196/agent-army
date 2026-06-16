import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RunState } from '../src/run-state.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-army-run-'));
  const dates = [
    new Date('2026-06-15T10:30:12.123Z'),
    new Date('2026-06-15T10:30:13.000Z'),
    new Date('2026-06-15T10:34:00.000Z'),
    new Date('2026-06-15T10:40:00.000Z'),
  ];
  let index = 0;
  const state = new RunState({
    runtimeDir: dir,
    cwd: '/workspace',
    config: { codexBin: 'codex', agents: ['manager', 'brainstorming'] },
    now: () => dates[Math.min(index++, dates.length - 1)],
    random: () => 'abc123',
  });
  return { dir, state };
}

test('creates fresh run metadata and persists it', () => {
  const { dir, state } = fixture();
  try {
    const run = state.create();

    assert.equal(run.cwd, '/workspace');
    assert.equal(run.config.codexBin, 'codex');
    assert.match(run.runId, /^2026-06-15T10-30-12-123Z-abc123$/);
    assert.deepEqual(JSON.parse(readFileSync(state.runFile, 'utf8')).agents, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('records spawn, close, completed context, and active projection', () => {
  const { dir, state } = fixture();
  try {
    state.create();
    state.recordSpawn('manager', { port: 51234, threadId: 'thread-manager' });
    state.recordSpawn('brainstorming', {
      port: 51235,
      threadId: 'thread-brainstorming',
      task: { taskId: 'task-1', contextKey: 'feature:x', title: 'Plan feature X' },
    });
    state.recordClose('brainstorming', {
      contextKey: 'feature:x',
      title: 'Feature X',
      summary: 'Produced a handoff.',
    });

    assert.deepEqual(Object.keys(state.activeAgents()), ['manager']);
    assert.equal(state.snapshot().agents.brainstorming.status, 'closed');
    assert.deepEqual(state.snapshot().completedContexts, [{
      contextKey: 'feature:x',
      title: 'Feature X',
      summary: 'Produced a handoff.',
      agentSessions: [{ agent: 'brainstorming', type: 'brainstorming', sessionId: 'thread-brainstorming', threadId: 'thread-brainstorming' }],
      updatedAt: '2026-06-15T10:40:00.000Z',
    }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tracks same-type runtime agent ids independently', () => {
  const { dir, state } = fixture();
  try {
    state.create();
    state.recordSpawn('debug', { type: 'debug', port: 51236, threadId: 'thread-debug' });
    state.recordSpawn('debug-2', { type: 'debug', port: 51237, threadId: 'thread-debug-2' });
    state.recordClose('debug-2', {
      contextKey: 'bug:b',
      title: 'Bug B',
      summary: 'Found the second root cause.',
    });

    assert.deepEqual(Object.keys(state.activeAgents()), ['debug']);
    assert.equal(state.activeAgents().debug.agentId, 'debug');
    assert.equal(state.activeAgents().debug.type, 'debug');
    assert.equal(state.snapshot().agents['debug-2'].type, 'debug');
    assert.deepEqual(state.snapshot().completedContexts.at(-1).agentSessions, [{
      agent: 'debug-2',
      type: 'debug',
      sessionId: 'thread-debug-2',
      threadId: 'thread-debug-2',
    }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
