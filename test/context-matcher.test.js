import test from 'node:test';
import assert from 'node:assert/strict';

import { rankImplementationCandidates } from '../src/context-matcher.js';

test('ranks exact feature-name matches above other candidates', () => {
  const ranked = rankImplementationCandidates({
    issue: {
      title: 'Billing API charge endpoint returns 500',
      body: 'Failure when calling the charge flow',
      projectKey: 'OPS',
      labels: ['api'],
    },
    candidates: [
      {
        implementation: { id: 1, name: 'Charge endpoint', target: '/v1/charges' },
        feature: { name: 'Billing API' },
        project: { key: 'OPS', name: 'Operations' },
        notes: [],
      },
      {
        implementation: { id: 2, name: 'Invoice export job', target: 'invoice-export' },
        feature: { name: 'Exports' },
        project: { key: 'OPS', name: 'Operations' },
        notes: [],
      },
    ],
  });

  assert.equal(ranked[0].implementation.id, 1);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.match(ranked[0].reasons.join(' '), /feature/i);
});

test('boosts candidates whose target identity appears in the issue', () => {
  const ranked = rankImplementationCandidates({
    issue: {
      title: 'POST /v1/charges returns 500',
      body: 'Staging logs mention /v1/charges',
      projectKey: 'OPS',
      labels: [],
    },
    candidates: [
      {
        implementation: { id: 1, name: 'Charge endpoint', target: '/v1/charges' },
        feature: { name: 'Billing API' },
        project: { key: 'OPS', name: 'Operations' },
        notes: [],
      },
      {
        implementation: { id: 2, name: 'Invoice export job', target: 'invoice-export' },
        feature: { name: 'Exports' },
        project: { key: 'OPS', name: 'Operations' },
        notes: [],
      },
    ],
  });

  assert.equal(ranked[0].implementation.id, 1);
  assert.match(ranked[0].reasons.join(' '), /target/i);
});

test('prefers verified note evidence over unverified hints', () => {
  const ranked = rankImplementationCandidates({
    issue: {
      title: '500 while charging customer',
      body: 'staging issue',
      projectKey: 'OPS',
      labels: [],
    },
    candidates: [
      {
        implementation: { id: 1, name: 'Charge endpoint', target: '/v1/charges' },
        feature: { name: 'Billing API' },
        project: { key: 'OPS', name: 'Operations' },
        notes: [{ trustLevel: 'verified', body: 'Verified against staging charge failures.' }],
      },
      {
        implementation: { id: 2, name: 'Charge endpoint retry worker', target: 'charge-retry-worker' },
        feature: { name: 'Billing API' },
        project: { key: 'OPS', name: 'Operations' },
        notes: [{ trustLevel: 'hint', body: 'Might be related to charge retries.' }],
      },
    ],
  });

  assert.equal(ranked[0].implementation.id, 1);
  assert.ok(ranked[0].score > ranked[1].score);
});

test('falls back to project alignment when stronger signals are absent', () => {
  const ranked = rankImplementationCandidates({
    issue: {
      title: 'Unknown failure in operations',
      body: 'Needs triage',
      projectKey: 'OPS',
      labels: [],
    },
    candidates: [
      {
        implementation: { id: 1, name: 'Billing API', target: '/v1/charges' },
        feature: { name: 'Billing API' },
        project: { key: 'OPS', name: 'Operations' },
        notes: [],
      },
      {
        implementation: { id: 2, name: 'CRM sync', target: 'crm-sync' },
        feature: { name: 'CRM' },
        project: { key: 'CRM', name: 'CRM' },
        notes: [],
      },
    ],
  });

  assert.equal(ranked[0].implementation.id, 1);
  assert.match(ranked[0].reasons.join(' '), /project/i);
});
