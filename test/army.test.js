import test from 'node:test';
import assert from 'node:assert/strict';
import { Army } from '../src/army.js';
import { AGENT_NAMES, prompts } from '../src/agents.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test('serializes turns sent to the same agent', async () => {
  const first = deferred();
  const calls = [];
  const army = new Army({
    isAgentActive: () => true,
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
    isAgentActive: () => true,
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
  const army = new Army({ sendTurn: async () => 'ok', isAgentActive: () => true });

  await assert.rejects(() => army.sendAgentMessage('missing', 'hello'), /unknown agent/i);
  assert.throws(() => army.reportStatus('brainstorming', 'unknown', 'hello'), /invalid status/i);
});

test('not-started specialists fail clearly when messaged before spawn', async () => {
  const army = new Army({ sendTurn: async () => 'ok', isAgentActive: name => name === 'manager' });

  assert.equal(army.getAgentStatus('brainstorming'), 'not_started');
  await assert.rejects(
    () => army.sendAgentMessage('brainstorming', 'hello'),
    /agent is not active: brainstorming/i,
  );
});

test('dynamic agents of the same type keep independent turn queues', async () => {
  const debug = deferred();
  const calls = [];
  const army = new Army({
    isAgentActive: name => name === 'debug' || name === 'debug-2',
    sendTurn: async (agent, message) => {
      calls.push([agent, message]);
      if (agent === 'debug' && message === 'slow') await debug.promise;
      return `${agent}:${message}`;
    },
  });
  army.ensureAgent('debug', { type: 'debug', initialStatus: 'idle' });
  army.ensureAgent('debug-2', { type: 'debug', initialStatus: 'idle' });

  const slow = army.sendAgentMessage('debug', 'slow');
  const fast = army.sendAgentMessage('debug-2', 'fast');
  await Promise.resolve();

  assert.deepEqual(calls, [['debug', 'slow'], ['debug-2', 'fast']]);
  assert.equal(await fast, 'debug-2:fast');
  debug.resolve();
  assert.equal(await slow, 'debug:slow');
});

test('messaging an unspawned generated id fails clearly', async () => {
  const army = new Army({ sendTurn: async () => 'ok', isAgentActive: name => name === 'debug' });

  await assert.rejects(
    () => army.sendAgentMessage('debug-2', 'hello'),
    /unknown agent: debug-2/i,
  );
});

test('reports from dynamic runtime ids are attributed to that id', async () => {
  const calls = [];
  const army = new Army({ sendTurn: async (agent, message) => { calls.push([agent, message]); return 'ok'; } });
  army.ensureAgent('debug-2', { type: 'debug', initialStatus: 'idle' });

  army.reportStatus('debug-2', 'completed', 'isolated root cause');
  await army.whenIdle();

  assert.equal(army.getAgentStatus('debug-2'), 'completed');
  assert.deepEqual(army.listAgentMessages('debug-2'), [{
    from: 'debug-2',
    status: 'completed',
    message: 'isolated root cause',
  }]);
  assert.deepEqual(calls, [['manager', '[debug-2 reported completed]\nisolated root cause']]);
});

test('registers specialist agents that can report status', async () => {
  assert.deepEqual(AGENT_NAMES, ['manager', 'brainstorming', 'implementation', 'debug', 'tester']);

  const army = new Army({ sendTurn: async () => 'ok' });
  army.reportStatus('debug', 'completed', 'fixed a failing test');
  army.reportStatus('tester', 'completed', 'verified the CLI');

  assert.equal(army.getAgentStatus('debug'), 'completed');
  assert.equal(army.getAgentStatus('tester'), 'completed');
  assert.deepEqual(army.listAgentMessages('debug'), [{
    from: 'debug',
    status: 'completed',
    message: 'fixed a failing test',
  }]);
  assert.deepEqual(army.listAgentMessages('tester'), [{
    from: 'tester',
    status: 'completed',
    message: 'verified the CLI',
  }]);
});

test('manager prompt routes debugging work to the debug agent', () => {
  assert.match(prompts.manager, /agent="debug"/);
  assert.match(prompts.manager, /failing tests, runtime errors, regressions/);
  assert.match(prompts.manager, /delegate to debug/);
  assert.match(prompts.debug, /disciplined debugging loop/);
  assert.match(prompts.debug, /Report what failed, why it failed/);
});

test('manager prompt routes verification work to the tester agent', () => {
  assert.match(prompts.manager, /five-agent Agent Army/);
  assert.match(prompts.manager, /agent="tester"/);
  assert.match(prompts.manager, /delegate to tester/);
  assert.match(prompts.manager, /Use `debug` when the primary job is root cause analysis/);
  assert.match(prompts.manager, /Use `tester` when the primary job is verification/);
  assert.match(prompts.tester, /verify real behavior broadly/);
  assert.match(prompts.tester, /status codes, response bodies/);
  assert.match(prompts.tester, /exact commands\/checks run/);
});
