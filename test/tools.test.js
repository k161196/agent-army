import test from 'node:test';
import assert from 'node:assert/strict';
import { toolDefinitions, callTool } from '../src/tools.js';

test('manager receives routing and inspection tools', () => {
  assert.deepEqual(toolDefinitions('manager').map(tool => tool.name), [
    'send_agent_message',
    'get_agent_status',
    'list_agent_messages',
  ]);
});

test('non-manager receives only report_status', () => {
  assert.deepEqual(toolDefinitions('brainstorming').map(tool => tool.name), ['report_status']);
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
  await callTool('brainstorming', 'report_status', { status: 'completed', message: 'done' }, request);

  assert.deepEqual(calls, [
    ['/agents/brainstorming/messages', { message: 'think' }],
    ['/agents/brainstorming/status', { status: 'completed', message: 'done' }],
  ]);
});
