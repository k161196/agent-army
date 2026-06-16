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
