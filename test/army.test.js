import test from 'node:test';
import assert from 'node:assert/strict';
import { Army } from '../src/army.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test('serializes turns sent to the same agent', async () => {
  const first = deferred();
  const calls = [];
  const army = new Army({
    sendTurn: async (agent, message) => {
      calls.push([agent, message]);
      if (message === 'first') await first.promise;
      return `${message} response`;
    },
  });

  const one = army.sendAgentMessage('brainstorming', 'first');
  const two = army.sendAgentMessage('brainstorming', 'second');
  await Promise.resolve();
  assert.deepEqual(calls, [['brainstorming', 'first']]);

  first.resolve();
  await Promise.all([one, two]);
  assert.deepEqual(calls, [
    ['brainstorming', 'first'],
    ['brainstorming', 'second'],
  ]);
});

test('prioritizes queued user messages before agent reports', async () => {
  const active = deferred();
  const calls = [];
  const army = new Army({
    sendTurn: async (agent, message) => {
      calls.push([agent, message]);
      if (message === 'active') await active.promise;
      return 'ok';
    },
  });

  const running = army.sendUserMessage('active');
  await Promise.resolve();
  army.reportStatus('brainstorming', 'completed', 'brainstorm result');
  army.sendUserMessage('urgent user request');

  active.resolve();
  await running;
  await army.whenIdle();

  assert.deepEqual(calls.map(([, message]) => message), [
    'active',
    'urgent user request',
    '[brainstorming reported completed]\nbrainstorm result',
  ]);
});

test('rejects unknown agents and invalid statuses', async () => {
  const army = new Army({ sendTurn: async () => 'ok' });

  await assert.rejects(() => army.sendAgentMessage('missing', 'hello'), /unknown agent/i);
  assert.throws(() => army.reportStatus('brainstorming', 'unknown', 'hello'), /invalid status/i);
});
