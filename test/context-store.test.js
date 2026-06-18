import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createContextStore } from '../src/context-store.js';

function withStore(callback) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-army-context-store-'));
  const dbPath = join(dir, 'context.db');
  const store = createContextStore({ dbPath, now: () => new Date('2026-06-18T12:00:00.000Z') });

  try {
    store.init();
    return callback(store, dbPath);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('bootstraps required context tables', () => {
  withStore((store) => {
    const tables = new Set(store.listTableNames());

    for (const name of [
      'schema_migrations',
      'organizations',
      'projects',
      'features',
      'implementations',
      'implementation_repos',
      'issues',
      'notes',
      'people',
      'tools',
    ]) {
      assert.equal(tables.has(name), true, `expected table ${name}`);
    }
  });
});

test('creates and reads organization, project, feature, and implementation records', () => {
  withStore((store) => {
    const organization = store.createOrganization({ name: 'Acme' });
    const project = store.createProject({
      organizationId: organization.id,
      key: 'OPS',
      name: 'Operations',
    });
    const feature = store.createFeature({
      projectId: project.id,
      name: 'Billing API',
      description: 'Customer billing workflow',
    });
    const implementation = store.createImplementation({
      featureId: feature.id,
      name: 'Charge endpoint',
      type: 'api',
      status: 'ready',
      target: '/v1/charges',
      runInstructions: 'npm run dev',
      invocationExample: 'curl -X POST /v1/charges',
      expectedResult: '201 Created',
      verificationCheck: 'response contains charge id',
      codePointers: [{ repo: 'api', path: 'src/routes/charges.js', symbol: 'createCharge' }],
      repos: [{ repoName: 'api', repoPath: '/repos/api' }],
    });

    assert.equal(store.getOrganization(organization.id).name, 'Acme');
    assert.equal(store.getProject(project.id).key, 'OPS');
    assert.equal(store.getFeature(feature.id).name, 'Billing API');

    const persisted = store.getImplementation(implementation.id);
    assert.equal(persisted.target, '/v1/charges');
    assert.deepEqual(persisted.repos, [{ repoName: 'api', repoPath: '/repos/api' }]);
    assert.deepEqual(persisted.codePointers, [
      { repo: 'api', path: 'src/routes/charges.js', symbol: 'createCharge' },
    ]);
  });
});

test('updates implementation fields and keeps append-only notes separate', () => {
  withStore((store) => {
    const organization = store.createOrganization({ name: 'Acme' });
    const project = store.createProject({
      organizationId: organization.id,
      key: 'OPS',
      name: 'Operations',
    });
    const feature = store.createFeature({ projectId: project.id, name: 'Billing API' });
    const implementation = store.createImplementation({
      featureId: feature.id,
      name: 'Charge endpoint',
      type: 'api',
      status: 'incomplete',
      target: '/v1/charges',
    });

    const updated = store.updateImplementation(implementation.id, {
      status: 'ready',
      runInstructions: 'npm run dev',
      verificationCheck: 'returns 201',
    });
    const noteOne = store.addNote({
      entityType: 'implementation',
      entityId: implementation.id,
      authorType: 'agent',
      authorId: 'implementation-1',
      trustLevel: 'verified',
      body: 'Confirmed locally against staging fixture.',
    });
    const noteTwo = store.addNote({
      entityType: 'implementation',
      entityId: implementation.id,
      authorType: 'user',
      authorId: 'kiran',
      trustLevel: 'hint',
      body: 'Fails if auth token is expired.',
    });

    assert.equal(updated.status, 'ready');
    assert.equal(store.getImplementation(implementation.id).runInstructions, 'npm run dev');
    assert.deepEqual(store.listNotes('implementation', implementation.id), [noteOne, noteTwo]);
  });
});

test('stores and updates Jira issue snapshots', () => {
  withStore((store) => {
    const issue = store.upsertIssue({
      key: 'OPS-101',
      source: 'jira',
      title: 'Charge endpoint returns 500',
      body: 'Observed in staging',
      projectKey: 'OPS',
      components: ['billing'],
      labels: ['api', 'urgent'],
      repoNames: ['api'],
      status: 'new',
      snapshot: { key: 'OPS-101', fields: { summary: 'Charge endpoint returns 500' } },
    });

    const updated = store.upsertIssue({
      key: 'OPS-101',
      source: 'jira',
      title: 'Charge endpoint returns 500 on expired tokens',
      body: 'Observed in staging with stale auth token',
      projectKey: 'OPS',
      components: ['billing'],
      labels: ['api', 'urgent'],
      repoNames: ['api'],
      status: 'matched',
      implementationId: 42,
      snapshot: { key: 'OPS-101', fields: { summary: 'Updated summary' } },
    });

    assert.equal(issue.key, 'OPS-101');
    assert.equal(updated.status, 'matched');
    assert.equal(updated.implementationId, 42);
    assert.equal(store.getIssueByKey('OPS-101').title, 'Charge endpoint returns 500 on expired tokens');
  });
});
