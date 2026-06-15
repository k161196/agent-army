import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

test('responds to Codex MCP initialization request ID zero', async () => {
  const child = spawn('node', [join(process.cwd(), 'src', 'mcp-server.js')], {
    env: {
      ...globalThis.process.env,
      AGENT_ARMY_ROLE: 'manager',
      AGENT_ARMY_API: 'http://127.0.0.1:1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const response = new Promise((resolve, reject) => {
    createInterface({ input: child.stdout }).once('line', line => resolve(JSON.parse(line)));
    child.once('error', reject);
  });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26' },
  })}\n`);

  assert.equal((await response).id, 0);
  child.kill();
});
