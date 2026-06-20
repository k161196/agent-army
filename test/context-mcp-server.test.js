import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function startServer() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-army-context-mcp-'));
  const dbPath = join(dir, 'context.db');
  const child = spawn('node', [join(process.cwd(), 'src', 'context-mcp-server.js')], {
    env: {
      ...process.env,
      AGENT_ARMY_DB_PATH: dbPath,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });

  let nextId = 0;
  const pending = new Map();

  lines.on('line', (line) => {
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
    }
  });

  return {
    async request(method, params = {}) {
      const id = nextId;
      nextId += 1;
      const response = new Promise((resolve) => pending.set(id, resolve));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      const message = await response;
      pending.delete(id);
      if (message.error) throw new Error(message.error.message);
      return message.result;
    },
    close() {
      lines.close();
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function call(server, name, args = {}) {
  const result = await server.request('tools/call', { name, arguments: args });
  return JSON.parse(result.content[0].text);
}

test('context MCP exposes add and edit tools for all context data tables', async () => {
  const server = startServer();
  try {
    await server.request('initialize', { protocolVersion: '2025-03-26' });
    const result = await server.request('tools/list');
    const names = new Set(result.tools.map((tool) => tool.name));

    for (const disallowed of ['context_schema', 'context_query', 'context_execute', 'context_list_tables']) {
      assert.equal(names.has(disallowed), false, `did not expect ${disallowed}`);
    }

    for (const required of [
      'context_add_organization',
      'context_edit_organization',
      'context_add_project',
      'context_edit_project',
      'context_add_feature',
      'context_edit_feature',
      'context_add_repo',
      'context_edit_repo',
      'context_add_branch',
      'context_edit_branch',
      'context_add_implementation',
      'context_edit_implementation',
      'context_add_implementation_repo',
      'context_edit_implementation_repo',
      'context_add_issue',
      'context_edit_issue',
      'context_add_note',
      'context_edit_note',
      'context_add_person',
      'context_edit_person',
      'context_add_tool',
      'context_edit_tool',
    ]) {
      assert.equal(names.has(required), true, `expected ${required}`);
    }
  } finally {
    server.close();
  }
});

test('context MCP can add and edit semantic records across entities', async () => {
  const server = startServer();
  try {
    await server.request('initialize', { protocolVersion: '2025-03-26' });

    const organization = await call(server, 'context_add_organization', { name: 'Acme' });
    const editedOrganization = await call(server, 'context_edit_organization', {
      organizationId: organization.id,
      name: 'Acme Labs',
    });

    const project = await call(server, 'context_add_project', {
      organizationId: organization.id,
      key: 'OPS',
      name: 'Operations',
    });
    const feature = await call(server, 'context_add_feature', {
      projectId: project.id,
      name: 'Billing API',
      description: 'Charge creation flow',
    });

    const issue = await call(server, 'context_add_issue', {
      issueKey: 'OPS-101',
      source: 'jira',
      status: 'new',
      title: 'Charge endpoint fails',
      projectKey: 'OPS',
      components: ['billing'],
      labels: ['api'],
      repoNames: ['acme/api'],
      snapshot: { key: 'OPS-101' },
    });
    const editedIssue = await call(server, 'context_edit_issue', {
      issueId: issue.id,
      status: 'triaged',
      title: 'Charge endpoint fails on expired token',
    });

    const note = await call(server, 'context_add_note', {
      entityType: 'issue',
      entityId: issue.id,
      authorType: 'agent',
      authorId: 'debug-1',
      trustLevel: 'verified',
      body: 'Reproduced locally',
    });
    const editedNote = await call(server, 'context_edit_note', {
      noteId: note.id,
      body: 'Reproduced locally with expired token',
    });

    const issues = await call(server, 'context_list_issues');
    const fetchedIssue = await call(server, 'context_get_issue', { issueKey: 'OPS-101' });

    assert.equal(editedOrganization.name, 'Acme Labs');
    assert.equal(feature.name, 'Billing API');
    assert.equal(editedIssue.status, 'triaged');
    assert.equal(editedNote.body, 'Reproduced locally with expired token');
    assert.equal(issues.length, 1);
    assert.equal(fetchedIssue.title, 'Charge endpoint fails on expired token');
  } finally {
    server.close();
  }
});
