import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCodexArgs, CodexAgent } from '../src/codex-agent.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('disables Codex built-in child agents for Agent Army sessions', () => {
  const args = buildCodexArgs({
    name: 'manager',
    port: 9001,
    apiUrl: 'http://127.0.0.1:9000',
    mcpScript: '/workspace/src/mcp-server.js',
  });

  assert.ok(args.includes('features.multi_agent=false'));
  assert.ok(args.includes('features.child_agents_md=false'));
});

test('passes specialist role and runtime agent id to MCP server env', () => {
  const args = buildCodexArgs({
    name: 'debug-2',
    role: 'debug',
    port: 9002,
    apiUrl: 'http://127.0.0.1:9000',
    mcpScript: '/workspace/src/mcp-server.js',
  });

  assert.ok(args.includes('mcp_servers.agent_army.env={AGENT_ARMY_ROLE="debug",AGENT_ARMY_AGENT_ID="debug-2",AGENT_ARMY_API="http://127.0.0.1:9000"}'));
});

test('CodexAgent exposes busy state and resolves immediately when idle', async () => {
  const agent = new CodexAgent({ name: 'debug' });

  assert.equal(agent.isBusy(), false);
  await agent.waitForIdle({ timeoutMs: 10 });
});

test('CodexAgent waitForIdle times out while a turn remains active', async () => {
  const agent = new CodexAgent({ name: 'debug' });
  agent.activeTurn = { response: '' };

  assert.equal(agent.isBusy(), true);
  await assert.rejects(
    () => agent.waitForIdle({ timeoutMs: 5 }),
    /debug active turn did not stop within 5ms/,
  );
});

test('CodexAgent settles the active turn before resolving idle waiters', () => {
  const source = readFileSync(join(root, 'src', 'codex-agent.js'), 'utf8');

  const completed = source.match(/if \(message\.method === 'turn\/completed'[\s\S]*?\n    }/);
  assert.ok(completed, 'turn/completed handler exists');
  assert.ok(
    completed[0].indexOf('turn.resolve(turn.response)') < completed[0].indexOf('this.#resolveIdleWaiters()'),
    'completed turn should settle before follow-up senders resume',
  );

  const error = source.match(/if \(message\.method === 'error'[\s\S]*?\n    }/);
  assert.ok(error, 'error handler exists');
  assert.ok(
    error[0].indexOf('turn.reject(') < error[0].indexOf('this.#resolveIdleWaiters()'),
    'interrupted turn should reject before follow-up senders resume',
  );
});
