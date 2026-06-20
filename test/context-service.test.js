import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createContextStore } from '../src/context-store.js';
import { createContextService } from '../src/context-service.js';
import { rankImplementationCandidates } from '../src/context-matcher.js';

async function withStore({ storeNow = '2026-06-18T12:00:00.000Z', serviceNow = storeNow, jira } = {}, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-army-context-service-'));
  const dbPath = join(dir, 'context.db');
  const store = createContextStore({ dbPath, now: () => new Date(storeNow) });
  store.init();

  const service = createContextService({
    store,
    matcher: { rankImplementationCandidates },
    jira,
    now: () => new Date(serviceNow),
  });

  try {
    return await callback({ store, service });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedImplementation(store, fields = {}) {
  const organization = store.createOrganization({ name: 'Acme' });
  const project = store.createProject({
    organizationId: organization.id,
    key: 'OPS',
    name: 'Operations',
  });
  const feature = store.createFeature({
    projectId: project.id,
    name: 'Billing API',
    description: 'Billing endpoints',
  });
  const repo = store.createRepo({ organizationId: organization.id, name: 'api', path: '/repos/api' });

  return store.createImplementation({
    featureId: feature.id,
    name: 'Charge endpoint',
    type: 'api',
    status: 'ready',
    target: '/v1/charges',
    runInstructions: 'npm run dev',
    testInstructions: 'npm test -- charges',
    invocationExample: 'curl -X POST /v1/charges',
    expectedResult: '201 Created',
    verificationCheck: 'response includes charge id',
    repos: [{ repoId: repo.id }],
    ...fields,
  });
}

test('flags missing implementation metadata before issue work can start', async () => {
  await withStore({}, ({ store, service }) => {
    const implementation = seedImplementation(store, {
      status: 'incomplete',
      runInstructions: null,
      testInstructions: null,
      verificationCheck: null,
      repos: [],
    });

    const readiness = service.evaluateImplementationReadiness(implementation.id);

    assert.equal(readiness.status, 'incomplete');
    assert.deepEqual(readiness.missingFields, [
      'repos',
      'runInstructions',
      'testInstructions',
      'verificationCheck',
    ]);
  });
});

test('marks issues ready_for_debug only when reproduction checklist is complete', async () => {
  await withStore({}, ({ store, service }) => {
    const implementation = seedImplementation(store);
    const issue = store.upsertIssue({
      key: 'OPS-101',
      source: 'jira',
      status: 'new',
      title: 'Charge endpoint returns 500',
      body: 'Observed in staging',
      projectKey: 'OPS',
      snapshot: {
        reproduction: {
          environment: 'staging',
          command: 'curl -X POST /v1/charges',
          payload: '{"amount": 10}',
          observedOutput: '500 Internal Server Error',
          expectedOutput: '201 Created',
          verificationMethod: 'response status is 201',
        },
      },
    });

    const readiness = service.evaluateIssueReadiness(issue.key, implementation.id);

    assert.equal(readiness.status, 'ready_for_debug');
    assert.equal(readiness.issue.status, 'ready_for_debug');
    assert.deepEqual(readiness.missingChecklistItems, []);
  });
});

test('returns missing reproduction items when issue details are incomplete', async () => {
  await withStore({}, ({ store, service }) => {
    const implementation = seedImplementation(store);
    store.upsertIssue({
      key: 'OPS-102',
      source: 'jira',
      status: 'new',
      title: 'Charge endpoint returns 500',
      body: 'Observed in staging',
      projectKey: 'OPS',
      snapshot: {
        reproduction: {
          environment: 'staging',
          command: 'curl -X POST /v1/charges',
          observedOutput: '500 Internal Server Error',
        },
      },
    });

    const readiness = service.evaluateIssueReadiness('OPS-102', implementation.id);

    assert.equal(readiness.status, 'needs_reproduction');
    assert.deepEqual(readiness.missingChecklistItems, [
      'payload',
      'expectedOutput',
      'verificationMethod',
    ]);
  });
});

test('fetches stores matches and summarizes Jira issues', async () => {
  await withStore(
    {
      jira: {
        fetchIssue: async () => ({
          key: 'OPS-103',
          source: 'jira',
          status: 'new',
          title: 'POST /v1/charges returns 500',
          body: 'Charge endpoint verified failing in staging',
          projectKey: 'OPS',
          labels: ['api'],
          components: ['billing'],
          snapshot: {
            reproduction: {
              environment: 'staging',
              command: 'curl -X POST /v1/charges',
              payload: '{"amount":10}',
              observedOutput: '500 Internal Server Error',
              expectedOutput: '201 Created',
              verificationMethod: 'response status is 201',
            },
          },
        }),
      },
    },
    async ({ store, service }) => {
      const implementation = seedImplementation(store);
      store.addNote({
        entityType: 'implementation',
        entityId: implementation.id,
        authorType: 'agent',
        authorId: 'implementation-1',
        trustLevel: 'verified',
        body: 'Charge endpoint verified in staging.',
      });

      const summary = await service.intakeJiraIssue('OPS-103');

      assert.equal(summary.issue.key, 'OPS-103');
      assert.equal(summary.match.requiresConfirmation, false);
      assert.equal(summary.match.candidates[0].implementation.id, implementation.id);
      assert.equal(summary.readiness.status, 'ready_for_debug');
      assert.equal(store.getIssueByKey('OPS-103').implementationId, implementation.id);
    },
  );
});

test('warns when best match is stale or low confidence', async () => {
  await withStore(
    {
      serviceNow: '2026-08-30T12:00:00.000Z',
    },
    ({ store, service }) => {
      const implementation = seedImplementation(store);
      store.upsertIssue({
        key: 'OPS-104',
        source: 'jira',
        status: 'new',
        title: 'Something is broken',
        body: 'Needs investigation',
        projectKey: 'OPS',
        snapshot: {},
      });

      const summary = service.suggestImplementations('OPS-104');

      assert.equal(summary.requiresConfirmation, true);
      assert.deepEqual(summary.warnings, ['implementation-stale', 'low-confidence-match']);
      assert.equal(summary.candidates[0].implementation.id, implementation.id);
    },
  );
});
