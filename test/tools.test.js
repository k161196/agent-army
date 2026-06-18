import test from 'node:test';
import assert from 'node:assert/strict';

import { toolDefinitions, callTool } from '../src/tools.js';

test('manager receives routing inspection and context tools', () => {
  assert.deepEqual(toolDefinitions('manager').map((tool) => tool.name), [
    'spawn_agent',
    'close_agent',
    'list_run_agents',
    'list_completed_contexts',
    'record_task_summary',
    'send_agent_message',
    'get_agent_status',
    'list_agent_messages',
    'context_intake_issue',
    'context_match_issue',
    'context_get_implementation',
    'context_add_note',
  ]);
});

test('specialists receive only report_status', () => {
  for (const role of ['brainstorming', 'implementation', 'debug', 'tester']) {
    assert.deepEqual(toolDefinitions(role).map((tool) => tool.name), ['report_status']);
  }
});

test('rejects tools outside role capability', async () => {
  await assert.rejects(
    () => callTool('brainstorming', 'send_agent_message', {}, async () => ({})),
    /not available/i,
  );
});

test('maps manager agent tools onto HTTP API calls', async () => {
  const calls = [];
  const request = async (path, body) => {
    calls.push([path, body]);
    return { ok: true };
  };

  const sendTool = toolDefinitions('manager').find((tool) => tool.name === 'send_agent_message');
  assert.equal(sendTool.inputSchema.properties.interrupt.type, 'boolean');

  await callTool('manager', 'send_agent_message', { agent: 'brainstorming', message: 'think' }, request);
  await callTool('manager', 'send_agent_message', { agent: 'debug', message: 'stop and inspect', interrupt: true }, request);
  await callTool('manager', 'spawn_agent', { agent: 'debug', title: 'Fix test', contextKey: 'bug:test' }, request);
  await callTool('manager', 'close_agent', { agent: 'debug', summary: 'Fixed test', contextKey: 'bug:test' }, request);
  await callTool('manager', 'list_run_agents', {}, request);
  await callTool('manager', 'list_completed_contexts', {}, request);
  await callTool('manager', 'record_task_summary', {
    contextKey: 'bug:test',
    title: 'Fix test',
    summary: 'done',
  }, request);
  await callTool('manager', 'context_intake_issue', { issueKey: 'OPS-101' }, request);
  await callTool('manager', 'context_match_issue', { issueKey: 'OPS-101' }, request);
  await callTool('manager', 'context_get_implementation', { implementationId: 7 }, request);
  await callTool('manager', 'context_add_note', {
    entityType: 'implementation',
    entityId: 7,
    authorType: 'agent',
    authorId: 'manager',
    trustLevel: 'verified',
    body: 'Ready to debug',
  }, request);
  await callTool({ role: 'debug', agentId: 'debug-2' }, 'report_status', { status: 'completed', message: 'done' }, request);
  await callTool('debug', 'report_status', { status: 'completed', message: 'legacy' }, request);

  assert.deepEqual(calls, [
    ['/agents/brainstorming/messages', { message: 'think', interrupt: false }],
    ['/agents/debug/messages', { message: 'stop and inspect', interrupt: true }],
    ['/agents/debug/spawn', { title: 'Fix test', contextKey: 'bug:test' }],
    ['/agents/debug/close', { summary: 'Fixed test', contextKey: 'bug:test' }],
    ['/run', undefined],
    ['/contexts', undefined],
    ['/contexts', { contextKey: 'bug:test', title: 'Fix test', summary: 'done', agentSessions: [] }],
    ['/context/issues/intake', { issueKey: 'OPS-101' }],
    ['/context/issues/OPS-101/candidates', undefined],
    ['/context/implementations/7', undefined],
    ['/context/notes', {
      entityType: 'implementation',
      entityId: 7,
      authorType: 'agent',
      authorId: 'manager',
      trustLevel: 'verified',
      body: 'Ready to debug',
    }],
    ['/agents/debug-2/status', { status: 'completed', message: 'done' }],
    ['/agents/debug/status', { status: 'completed', message: 'legacy' }],
  ]);
});
