import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('runtime publishes agent state only after lifecycle pane sync', () => {
  const source = readFileSync(join(root, 'src', 'runtime-server.js'), 'utf8');
  const match = source.match(/async function startCodexAgent[\s\S]*?\n}/);

  assert.ok(match, 'startCodexAgent exists');
  const body = match[0];

  assert.ok(
    body.indexOf('syncPaneSpawn(agentId)') < body.indexOf('writeState()'),
    'state.json should not appear ready before panes.json is persisted',
  );
});

test('runtime interrupt helper sends pane interrupt before bypass follow-up', () => {
  const source = readFileSync(join(root, 'src', 'runtime-server.js'), 'utf8');
  const match = source.match(/async function sendAgentMessage[\s\S]*?\n}/);

  assert.ok(match, 'sendAgentMessage helper exists');
  const body = match[0];

  assert.ok(body.includes('interruptLifecycleAgentPane(name'), 'helper sends pane interrupt');
  assert.ok(
    body.indexOf('interruptLifecycleAgentPane(name') < body.indexOf('agent.waitForIdle({ timeoutMs: 5000 })'),
    'runtime waits for idle after sending interrupt',
  );
  assert.ok(
    body.indexOf('agent.waitForIdle({ timeoutMs: 5000 })') < body.indexOf('bypassQueueAfterInterrupt: true'),
    'runtime bypasses the queue only after active turn idles',
  );
});
