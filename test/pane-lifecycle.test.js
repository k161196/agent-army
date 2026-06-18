import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attachInitialAgentPanes,
  attachLifecycleAgentPane,
  closeLifecycleAgentPane,
  interruptLifecycleAgentPane,
  syncAgentPanes,
} from '../src/pane-lifecycle.js';

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

function tempPanesDir() {
  return mkdtempSync(join(tmpdir(), 'agent-army-panes-'));
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function specialistState() {
  return {
    cwd: '/workspace',
    agents: {
      manager: { port: 1001, threadId: 'manager-thread', type: 'manager' },
      debug: { port: 1002, threadId: 'debug-thread', type: 'debug' },
      'debug-2': { port: 1003, threadId: 'debug-thread-2', type: 'debug' },
    },
  };
}

test('initial attach refreshes persisted manager pane alongside specialist panes', () => {
  withCmux(() => {
    const dir = tempPanesDir();
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ manager: 'surface:1', debug: 'surface:2' }));
      const calls = [];

      const panes = attachInitialAgentPanes(specialistState(), {
        panesFile,
        target: null,
        exec: (command, args) => {
          calls.push([command, args]);
          if (command === 'cmux' && args[0] === 'list-pane-surfaces') {
            return JSON.stringify({
              surfaces: [
                { ref: 'surface:1', title: 'manager' },
                { ref: 'surface:2', title: 'debug' },
              ],
            });
          }
          if (command === 'cmux' && args[0] === 'list-panes') {
            return JSON.stringify({ panes: [{ ref: 'pane:2', surface_refs: ['surface:2'] }] });
          }
          return '';
        },
      });

      assert.equal(panes.manager, 'surface:1');
      assert.equal(panes.debug, 'surface:2');
      assert.equal(calls.some(([, args]) => args.some(v => String(v).includes('manager-thread'))), true);
      assert.equal(calls.some(([, args]) => args.includes('surface:2') && args[0] === 'send'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('sync preserves existing manager and specialist panes without re-sending commands', () => {
  withCmux(() => {
    const dir = tempPanesDir();
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ manager: 'surface:1', debug: 'surface:2' }));
      const calls = [];
      const panes = { manager: 'surface:1', debug: 'surface:2' };

      syncAgentPanes(specialistState(), panes, {
        panesFile,
        target: null,
        exec: (command, args) => {
          calls.push([command, args]);
          return '';
        },
      });

      assert.equal(panes.manager, 'surface:1');
      assert.equal(panes.debug, 'surface:2');
      assert.equal(calls.some(([, args]) => args.some(v => String(v).includes('manager-thread'))), false);
      const sentToExisting = calls.filter(([, args]) =>
        args[0] === 'send' && (args.includes('surface:1') || args.includes('surface:2')),
      );
      assert.equal(sentToExisting.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('lifecycle attach refreshes existing manager pane', () => {
  withCmux(() => {
    const dir = tempPanesDir();
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ manager: 'surface:1' }));
      const calls = [];

      const pane = attachLifecycleAgentPane('manager', specialistState(), {
        panesFile,
        target: null,
        exec: (command, args) => {
          calls.push([command, args]);
          if (command === 'cmux' && args[0] === 'list-pane-surfaces') {
            return JSON.stringify({ surfaces: [{ ref: 'surface:1', title: 'manager' }] });
          }
          return '';
        },
      });

      assert.equal(pane, 'surface:1');
      assert.deepEqual(readJson(panesFile), { manager: 'surface:1' });
      assert.equal(calls.some(([, args]) => args.some(v => String(v).includes('manager-thread'))), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('lifecycle attach persists cmux surface per specialist runtime agent id', () => {
  withCmux(() => {
    const dir = tempPanesDir();
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ debug: 'surface:1' }));
      const calls = [];
      const exec = (command, args) => {
        calls.push([command, args]);
        if (command === 'cmux' && args[0] === 'list-panes') {
          const nth = calls.filter(([name, callArgs]) => name === 'cmux' && callArgs[0] === 'list-panes').length;
          return JSON.stringify(
            nth === 1
              ? { panes: [{ ref: 'pane:1', surface_refs: ['surface:1'] }] }
              : {
                  panes: [
                    { ref: 'pane:1', surface_refs: ['surface:1'] },
                    { ref: 'pane:2', surface_refs: ['surface:2'] },
                  ],
                },
          );
        }
        if (command === 'cmux' && args[0] === 'list-pane-surfaces') {
          return JSON.stringify({ surfaces: [{ ref: 'surface:1', title: 'debug' }] });
        }
        if (command === 'cmux' && args[0] === 'new-pane') {
          return JSON.stringify({ pane: { ref: 'pane:2' }, surface: { ref: 'surface:2' } });
        }
        return '';
      };

      const pane = attachLifecycleAgentPane('debug-2', specialistState(), {
        panesFile,
        target: null,
        exec,
      });

      assert.equal(pane, 'surface:2');
      assert.deepEqual(readJson(panesFile), { debug: 'surface:1', 'debug-2': 'surface:2' });
      assert.equal(calls.some(([, args]) => args[0] === 'new-pane'), true);
      assert.equal(
        calls.some(([, args]) => args.some(value => String(value).includes('debug-thread-2'))),
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('lifecycle close removes only requested runtime agent cmux surface', () => {
  withCmux(() => {
    const dir = tempPanesDir();
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ debug: 'surface:1', 'debug-2': 'surface:2' }));
      const calls = [];

      assert.equal(
        closeLifecycleAgentPane('debug', {
          panesFile,
          exec: (command, args) => calls.push([command, args]),
        }),
        true,
      );
      assert.deepEqual(readJson(panesFile), { 'debug-2': 'surface:2' });
      assert.deepEqual(calls, [['cmux', ['close-surface', '--surface', 'surface:1']]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('lifecycle removes empty pane mapping files', () => {
  withCmux(() => {
    const dir = tempPanesDir();
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ debug: 'surface:1' }));
      closeLifecycleAgentPane('debug', { panesFile, exec: () => '' });
      assert.equal(existsSync(panesFile), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('lifecycle interrupt reads persisted panes without mutating missing mappings', () => {
  withCmux(() => {
    const dir = tempPanesDir();
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ debug: 'surface:1' }));
      const calls = [];

      const result = interruptLifecycleAgentPane('debug-2', {
        panesFile,
        exec: (command, args) => calls.push([command, args]),
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason.includes('no pane is attached'), true);
      assert.deepEqual(readJson(panesFile), { debug: 'surface:1' });
      assert.deepEqual(calls, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
