import test from 'node:test';
import assert from 'node:assert/strict';
import { toolDefinitions, callTool } from '../src/tools.js';

test('manager receives routing and inspection tools', () => {
  assert.deepEqual(toolDefinitions('manager').map(tool => tool.name), [
    'spawn_agent',
    'close_agent',
    'list_run_agents',
    'list_completed_contexts',
    'record_task_summary',
    'send_agent_message',
    'get_agent_status',
    'list_agent_messages',
  ]);
});

test('specialists receive only report_status', () => {
  for (const role of ['brainstorming', 'implementation', 'debug', 'tester']) {
    assert.deepEqual(toolDefinitions(role).map(tool => tool.name), ['report_status']);
  }
});

test('rejects tools outside role capability', async () => {
  await assert.rejects(
    () => callTool('brainstorming', 'send_agent_message', {}, async () => ({})),
    /not available/i,
  );
});

test('maps manager and agent tools to HTTP API calls', async () => {
  const calls = [];
  const request = async (path, body) => {
    calls.push([path, body]);
    return { ok: true };
  };

  await callTool('manager', 'send_agent_message', { agent: 'brainstorming', message: 'think' }, request);
  await callTool('manager', 'spawn_agent', { agent: 'debug', title: 'Fix test', contextKey: 'bug:test' }, request);
  await callTool('manager', 'close_agent', { agent: 'debug', summary: 'Fixed test', contextKey: 'bug:test' }, request);
  await callTool('manager', 'list_run_agents', {}, request);
  await callTool('manager', 'list_completed_contexts', {}, request);
  await callTool('manager', 'record_task_summary', {
    contextKey: 'bug:test',
    title: 'Fix test',
    summary: 'Fixed by debug.',
    agentSessions: [{ agent: 'debug', sessionId: 'thread-debug' }],
  }, request);
  await callTool('brainstorming', 'report_status', { status: 'completed', message: 'done' }, request);
  await callTool('tester', 'report_status', { status: 'completed', message: 'verified' }, request);

  assert.deepEqual(calls, [
    ['/agents/brainstorming/messages', { message: 'think' }],
    ['/agents/debug/spawn', { title: 'Fix test', contextKey: 'bug:test' }],
    ['/agents/debug/close', { summary: 'Fixed test', contextKey: 'bug:test' }],
    ['/run', undefined],
    ['/contexts', undefined],
    ['/contexts', {
      contextKey: 'bug:test',
      title: 'Fix test',
      summary: 'Fixed by debug.',
      agentSessions: [{ agent: 'debug', sessionId: 'thread-debug' }],
    }],
    ['/agents/brainstorming/status', { status: 'completed', message: 'done' }],
    ['/agents/tester/status', { status: 'completed', message: 'verified' }],
  ]);
});
