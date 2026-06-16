import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachInitialAgentPanes, attachLifecycleAgentPane, closeLifecycleAgentPane } from '../src/pane-lifecycle.js';

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

test('lifecycle attach persists a cmux surface per runtime agent id', () => {
  withCmux(() => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-army-panes-'));
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ debug: 'surface:1' }));
      const state = {
        cwd: '/workspace',
        agents: {
          debug: { port: 1003, threadId: 'debug-thread', type: 'debug' },
          'debug-2': { port: 1004, threadId: 'debug-thread-2', type: 'debug' },
        },
      };
      const calls = [];
      const exec = (command, args) => {
        calls.push([command, args]);
        if (command === 'cmux' && args[0] === 'list-panes') {
          return JSON.stringify(calls.filter(([, item]) => item[0] === 'list-panes').length === 1
            ? { panes: [{ ref: 'pane:1', surface_refs: ['surface:1'] }] }
            : { panes: [{ ref: 'pane:1', surface_refs: ['surface:1'] }, { ref: 'pane:2', surface_refs: ['surface:2'] }] });
        }
        if (command === 'cmux' && args[0] === 'list-pane-surfaces') {
          return JSON.stringify({ surfaces: [{ ref: 'surface:1', title: 'debug' }] });
        }
        return '';
      };

      const pane = attachLifecycleAgentPane('debug-2', state, { panesFile, target: null, exec });

      assert.equal(pane, 'surface:2');
      assert.deepEqual(JSON.parse(readFileSync(panesFile, 'utf8')), {
        debug: 'surface:1',
        'debug-2': 'surface:2',
      });
      assert.deepEqual(calls.find(([, args]) => args[0] === 'rename-tab')?.[1], [
        'rename-tab', '--surface', 'surface:2', 'debug-2',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('initial attach reuses persisted runtime agent cmux surfaces', () => {
  withCmux(() => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-army-panes-'));
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ manager: 'surface:1' }));
      const state = {
        cwd: '/workspace',
        agents: {
          manager: { port: 1001, threadId: 'manager-thread' },
        },
      };
      const calls = [];

      const panes = attachInitialAgentPanes(state, {
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

      assert.deepEqual(panes, { manager: 'surface:1' });
      assert.equal(calls.some(([, args]) => args[0] === 'new-pane'), false);
      assert.equal(calls.some(([, args]) => args[0] === 'send'), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('lifecycle close removes only the requested runtime agent cmux surface', () => {
  withCmux(() => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-army-panes-'));
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ debug: 'surface:1', 'debug-2': 'surface:2' }));
      const calls = [];

      assert.equal(closeLifecycleAgentPane('debug', {
        panesFile,
        exec: (command, args) => calls.push([command, args]),
      }), true);

      assert.deepEqual(JSON.parse(readFileSync(panesFile, 'utf8')), { 'debug-2': 'surface:2' });
      assert.deepEqual(calls, [['cmux', ['close-surface', '--surface', 'surface:1']]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('lifecycle close removes empty pane mapping files', () => {
  withCmux(() => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-army-panes-'));
    const panesFile = join(dir, 'panes.json');
    try {
      writeFileSync(panesFile, JSON.stringify({ debug: 'surface:1' }));

      closeLifecycleAgentPane('debug', {
        panesFile,
        exec: () => '',
      });

      assert.equal(existsSync(panesFile), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
