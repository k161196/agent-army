import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAgentPanes, refreshAgentPanes } from '../src/tmux-panes.js';

const state = {
  cwd: '/workspace',
  agents: {
    manager: { port: 1001, threadId: 'manager-thread' },
    brainstorming: { port: 1002, threadId: 'brainstorm-thread' },
  },
};

test('records created tmux pane IDs by agent name', () => {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'split-window') return args.at(-1).includes('1001') ? '%10\n' : '%11\n';
    return '';
  };

  const panes = attachAgentPanes(state, '%1', exec);

  assert.deepEqual(panes, { manager: '%10', brainstorming: '%11' });
  assert.equal(calls.filter(([, args]) => args[0] === 'split-window').length, 2);
});

test('refreshes each attached pane with its persisted thread', () => {
  const calls = [];
  refreshAgentPanes(state, { manager: '%10', brainstorming: '%11' }, (command, args) => {
    calls.push([command, args]);
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(([, args]) => args.slice(0, 4)), [
    ['respawn-pane', '-k', '-t', '%10'],
    ['respawn-pane', '-k', '-t', '%11'],
  ]);
  assert.match(calls[1][1].at(-1), /1002 brainstorm-thread/);
});
