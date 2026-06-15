import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexArgs } from '../src/codex-agent.js';

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
