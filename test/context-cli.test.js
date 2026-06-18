import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function runCli(cwd, args, extraEnv = {}) {
  const result = spawnSync('node', [join(root, 'agent-army.js'), ...args], {
    cwd,
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }

  return JSON.parse(result.stdout);
}

test('context commands initialize and store implementations', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-army-context-cli-'));

  try {
    const init = runCli(cwd, ['context', 'init']);
    assert.match(init.dbPath, /\.agent-army\/context\.db$/);

    runCli(cwd, [
      'context',
      'add-feature',
      '--organization',
      'Acme',
      '--project-key',
      'OPS',
      '--project-name',
      'Operations',
      '--name',
      'Billing API',
    ]);

    const implementation = runCli(cwd, [
      'context',
      'add-implementation',
      '--project-key',
      'OPS',
      '--feature',
      'Billing API',
      '--name',
      'Charge endpoint',
      '--type',
      'api',
      '--target',
      '/v1/charges',
      '--repo',
      'api',
      '--repo-path',
      '/repos/api',
      '--run',
      'npm run dev',
      '--test',
      'npm test -- charges',
      '--invoke',
      'curl -X POST /v1/charges',
      '--expect',
      '201 Created',
      '--verify',
      'response includes charge id',
      '--status',
      'ready',
    ]);

    const shown = runCli(cwd, ['context', 'show', 'implementation', String(implementation.id)]);
    assert.equal(shown.name, 'Charge endpoint');
    assert.equal(shown.repos[0].repoName, 'api');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('issue commands fetch match and evaluate readiness', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-army-issue-cli-'));
  const jiraBin = join(cwd, 'jira-mock');

  writeFileSync(
    jiraBin,
    `#!/bin/sh
printf '%s' '{"key":"OPS-101","fields":{"summary":"POST /v1/charges returns 500","description":"Charge endpoint fails in staging","labels":["api"],"status":{"name":"In Progress"},"project":{"key":"OPS"},"components":[{"name":"billing"}],"reproduction":{"environment":"staging","command":"curl -X POST /v1/charges","payload":"{\\"amount\\":10}","observedOutput":"500 Internal Server Error","expectedOutput":"201 Created","verificationMethod":"response status is 201"}}}'
`,
  );
  chmodSync(jiraBin, 0o755);

  try {
    runCli(cwd, ['context', 'add-feature', '--organization', 'Acme', '--project-key', 'OPS', '--project-name', 'Operations', '--name', 'Billing API']);
    const implementation = runCli(cwd, [
      'context',
      'add-implementation',
      '--project-key',
      'OPS',
      '--feature',
      'Billing API',
      '--name',
      'Charge endpoint',
      '--type',
      'api',
      '--target',
      '/v1/charges',
      '--repo',
      'api',
      '--run',
      'npm run dev',
      '--test',
      'npm test -- charges',
      '--invoke',
      'curl -X POST /v1/charges',
      '--expect',
      '201 Created',
      '--verify',
      'response includes charge id',
      '--status',
      'ready',
    ]);
    runCli(cwd, [
      'context',
      'add-note',
      '--entity-type',
      'implementation',
      '--entity-id',
      String(implementation.id),
      '--author-type',
      'agent',
      '--author-id',
      'implementation-1',
      '--trust-level',
      'verified',
      '--body',
      'Charge endpoint verified in staging',
    ]);

    const env = { AGENT_ARMY_JIRA_BIN: jiraBin };
    const fetched = runCli(cwd, ['issue', 'fetch', 'OPS-101'], env);
    const matched = runCli(cwd, ['issue', 'match', 'OPS-101'], env);
    const ready = runCli(
      cwd,
      ['issue', 'ready', 'OPS-101', '--implementation-id', String(implementation.id)],
      env,
    );

    assert.equal(fetched.key, 'OPS-101');
    assert.equal(matched.candidates[0].implementation.id, implementation.id);
    assert.equal(ready.status, 'ready_for_debug');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
