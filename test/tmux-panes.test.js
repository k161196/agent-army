import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAgentPane, attachAgentPanes, closeAgentPane, refreshAgentPanes, sendInterruptKey } from '../src/tmux-panes.js';

const state = {
  cwd: '/workspace',
  agents: {
    manager: { port: 1001, threadId: 'manager-thread' },
  },
};

function withoutCmux(callback) {
  const previous = process.env.CMUX_WORKSPACE_ID;
  delete process.env.CMUX_WORKSPACE_ID;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.CMUX_WORKSPACE_ID;
    else process.env.CMUX_WORKSPACE_ID = previous;
  }
}

function withCmux(callback) {
  const previous = process.env.CMUX_WORKSPACE_ID;
  process.env.CMUX_WORKSPACE_ID = 'workspace:1';
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.CMUX_WORKSPACE_ID;
    else process.env.CMUX_WORKSPACE_ID = previous;
  }
}

test('initial attach with only manager creates one named tmux pane', () => {
  withoutCmux(() => {
    const calls = [];
    const exec = (command, args) => {
      calls.push([command, args]);
      if (args[0] === 'split-window') {
        assert.match(args.at(-1), /Agent Army: manager/);
        return '%10\n';
      }
      return '';
    };

    const panes = attachAgentPanes(state, '%1', exec);

    assert.deepEqual(panes, { manager: '%10' });
    assert.equal(calls.filter(([, args]) => args[0] === 'split-window').length, 1);
    assert.deepEqual(calls.find(([, args]) => args[0] === 'select-pane')?.[1], [
      'select-pane', '-t', '%10', '-T', 'Agent Army: manager',
    ]);
  });
});

test('dynamically attaches one specialist pane and renames it', () => {
  withoutCmux(() => {
    const active = {
      cwd: '/workspace',
      agents: {
        brainstorming: { port: 1002, threadId: 'brainstorm-thread' },
      },
    };
    const calls = [];
    const panes = {};
    const pane = attachAgentPane('brainstorming', active, panes, '%1', (command, args) => {
      calls.push([command, args]);
      if (args[0] === 'split-window') return '%11\n';
      return '';
    });

    assert.equal(pane, '%11');
    assert.deepEqual(panes, { brainstorming: '%11' });
    assert.match(calls.find(([, args]) => args[0] === 'split-window')[1].at(-1), /1002 brainstorm-thread/);
    assert.deepEqual(calls.find(([, args]) => args[0] === 'select-pane')?.[1], [
      'select-pane', '-t', '%11', '-T', 'Agent Army: brainstorming',
    ]);
  });
});

test('attaches multiple same-type runtime ids as distinct panes', () => {
  withoutCmux(() => {
    const active = {
      cwd: '/workspace',
      agents: {
        debug: { port: 1003, threadId: 'debug-thread', type: 'debug' },
        'debug-2': { port: 1004, threadId: 'debug-thread-2', type: 'debug' },
      },
    };
    const calls = [];
    const panes = attachAgentPanes(active, '%1', (command, args) => {
      calls.push([command, args]);
      if (args[0] === 'split-window') return `%${10 + calls.filter(([, item]) => item[0] === 'split-window').length}\n`;
      return '';
    });

    assert.deepEqual(Object.keys(panes), ['debug', 'debug-2']);
    assert.match(calls.find(([, args]) => args.at(-1)?.includes('debug-thread-2'))?.[1].at(-1), /1004 debug-thread-2/);
    assert.deepEqual(calls.filter(([, args]) => args[0] === 'select-pane').map(([, args]) => args.at(-1)), [
      'Agent Army: debug',
      'Agent Army: debug-2',
    ]);
  });
});

test('closing one same-type runtime id leaves the other pane mapping intact', () => {
  withoutCmux(() => {
    const panes = { debug: '%11', 'debug-2': '%12' };
    const calls = [];
    assert.equal(closeAgentPane('debug-2', panes, (command, args) => calls.push([command, args])), true);

    assert.deepEqual(panes, { debug: '%11' });
    assert.deepEqual(calls, [['tmux', ['kill-pane', '-t', '%12']]]);
  });
});

test('refreshAgentPanes refreshes active panes only', () => {
  withoutCmux(() => {
    const active = {
      cwd: '/workspace',
      agents: {
        brainstorming: { port: 1002, threadId: 'brainstorm-thread' },
      },
    };
    const calls = [];
    refreshAgentPanes(active, { manager: '%10', brainstorming: '%11' }, (command, args) => {
      calls.push([command, args]);
    });

    assert.equal(calls.filter(([, args]) => args[0] === 'respawn-pane').length, 1);
    assert.deepEqual(calls[0][1].slice(0, 4), ['respawn-pane', '-k', '-t', '%11']);
    assert.match(calls[0][1].at(-1), /1002 brainstorm-thread/);
  });
});

test('closeAgentPane kills tmux pane and removes mapping', () => {
  withoutCmux(() => {
    const panes = { brainstorming: '%11' };
    const calls = [];
    assert.equal(closeAgentPane('brainstorming', panes, (command, args) => calls.push([command, args])), true);

    assert.deepEqual(panes, {});
    assert.deepEqual(calls, [['tmux', ['kill-pane', '-t', '%11']]]);
  });
});

test('tmux interrupt sends Escape to the agent pane', () => {
  withoutCmux(() => {
    const calls = [];
    assert.deepEqual(sendInterruptKey('debug', { debug: '%11' }, (command, args) => calls.push([command, args])), {
      ok: true,
    });
    assert.deepEqual(calls, [['tmux', ['send-keys', '-t', '%11', 'Escape']]]);
  });
});

test('cmux attach renames new tab to the agent role', () => {
  withCmux(() => {
    const calls = [];
    const exec = (command, args) => {
      calls.push([command, args]);
      if (command === 'cmux' && args[0] === 'list-panes') {
        return JSON.stringify(calls.filter(([, item]) => item[0] === 'list-panes').length === 1
          ? { panes: [{ ref: 'pane:1', surface_refs: ['surface:1'] }] }
          : { panes: [{ ref: 'pane:1', surface_refs: ['surface:1'] }, { ref: 'pane:2', surface_refs: ['surface:2'] }] });
      }
      if (command === 'cmux' && args[0] === 'list-pane-surfaces') {
        return JSON.stringify({ surfaces: [{ ref: 'surface:1', title: 'shell' }] });
      }
      return '';
    };

    const panes = {};
    const pane = attachAgentPane('manager', state, panes, null, exec);

    assert.equal(pane, 'surface:2');
    assert.deepEqual(calls.find(([, args]) => args[0] === 'rename-tab')?.[1], [
      'rename-tab', '--surface', 'surface:2', 'manager',
    ]);
  });
});

test('cmux interrupt sends escape to the agent surface', () => {
  withCmux(() => {
    const calls = [];
    assert.deepEqual(sendInterruptKey('debug', { debug: 'surface:2' }, (command, args) => calls.push([command, args])), {
      ok: true,
    });
    assert.deepEqual(calls, [['cmux', ['send-key', '--surface', 'surface:2', 'escape']]]);
  });
});

test('cmux initial attach names the auto-started manager tab', () => {
  withCmux(() => {
    const calls = [];
    const exec = (command, args) => {
      calls.push([command, args]);
      if (command === 'cmux' && args[0] === 'list-panes') {
        return JSON.stringify(calls.filter(([, item]) => item[0] === 'list-panes').length === 1
          ? { panes: [] }
          : { panes: [{ ref: 'pane:1', surface_refs: ['surface:1'] }] });
      }
      if (command === 'cmux' && args[0] === 'list-pane-surfaces') {
        return JSON.stringify({ surfaces: [] });
      }
      return '';
    };

    const panes = attachAgentPanes(state, null, exec);

    assert.deepEqual(panes, { manager: 'surface:1' });
    assert.deepEqual(calls.find(([, args]) => args[0] === 'rename-tab')?.[1], [
      'rename-tab', '--surface', 'surface:1', 'manager',
    ]);
  });
});

test('cmux attach appends a count when an agent role already has tabs', () => {
  withCmux(() => {
    const calls = [];
    const exec = (command, args) => {
      calls.push([command, args]);
      if (command === 'cmux' && args[0] === 'list-panes') {
        return JSON.stringify(calls.filter(([, item]) => item[0] === 'list-panes').length === 1
          ? { panes: [{ ref: 'pane:1', surface_refs: ['surface:1'] }] }
          : { panes: [{ ref: 'pane:1', surface_refs: ['surface:1'] }, { ref: 'pane:2', surface_refs: ['surface:2'] }] });
      }
      if (command === 'cmux' && args[0] === 'list-pane-surfaces') {
        return JSON.stringify({
          surfaces: [
            { ref: 'surface:1', title: 'manager' },
            { ref: 'surface:3', title: 'manager-2' },
          ],
        });
      }
      return '';
    };

    attachAgentPane('manager', state, {}, null, exec);

    assert.deepEqual(calls.find(([, args]) => args[0] === 'rename-tab')?.[1], [
      'rename-tab', '--surface', 'surface:2', 'manager-3',
    ]);
  });
});
