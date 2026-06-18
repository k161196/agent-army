import test from 'node:test';
import assert from 'node:assert/strict';
import { renderManagerScreen } from '../src/manager-tui.js';

test('renderManagerScreen shows loading state', () => {
  const output = renderManagerScreen({
    ui: null,
    prompt: '[you] ',
    input: '',
    isLoading: true,
    width: 80,
  });

  assert.match(output, /Loading agent roster\.\.\./);
  assert.match(output, /\[you\] /);
});

test('renderManagerScreen truncates long session ids and summaries', () => {
  const output = renderManagerScreen({
    ui: {
      runId: 'run-123',
      managerStatus: 'idle',
      agents: [
        {
          name: 'implementation',
          status: 'working',
          sessionId: 'thread-implementation-very-long-session-id',
          summary: 'This summary is long enough that it should truncate inside the table renderer.',
        },
      ],
    },
    prompt: '[you] ',
    input: 'status',
    width: 72,
  });

  assert.match(output, /Name/);
  assert.match(output, /Session ID/);
  assert.match(output, /thread-implementa\.\.\./);
  assert.match(output, /summary/);
  assert.match(output, /\.{3}/);
  assert.match(output, /\[you\] status/);
});
