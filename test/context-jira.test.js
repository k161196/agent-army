import test from 'node:test';
import assert from 'node:assert/strict';

import { createContextJira } from '../src/context-jira.js';

test('normalizes Jira CLI JSON into local issue fields', async () => {
  const jira = createContextJira({
    run: async (command, args) => {
      assert.equal(command, 'jira');
      assert.deepEqual(args, ['issue', 'view', 'OPS-101', '--json']);

      return JSON.stringify({
        key: 'OPS-101',
        fields: {
          summary: 'Charge endpoint returns 500',
          description: 'Observed in staging',
          labels: ['api', 'urgent'],
          status: { name: 'In Progress' },
          project: { key: 'OPS' },
          components: [{ name: 'billing' }],
        },
      });
    },
  });

  const issue = await jira.fetchIssue('OPS-101');

  assert.deepEqual(issue, {
    key: 'OPS-101',
    source: 'jira',
    title: 'Charge endpoint returns 500',
    body: 'Observed in staging',
    labels: ['api', 'urgent'],
    components: ['billing'],
    projectKey: 'OPS',
    status: 'new',
    snapshot: {
      key: 'OPS-101',
      fields: {
        summary: 'Charge endpoint returns 500',
        description: 'Observed in staging',
        labels: ['api', 'urgent'],
        status: { name: 'In Progress' },
        project: { key: 'OPS' },
        components: [{ name: 'billing' }],
      },
    },
  });
});
