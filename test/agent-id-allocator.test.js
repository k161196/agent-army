import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentIdAllocator } from '../src/agent-id-allocator.js';

test('reserves generated same-type ids before async startup commits', () => {
  const active = new Set();
  const allocator = new AgentIdAllocator(() => active);

  const first = allocator.reserve('debug');
  const second = allocator.reserve('debug');

  assert.equal(first, 'debug');
  assert.equal(second, 'debug-2');
});

test('releases failed reservations so ids can be reused', () => {
  const active = new Set();
  const allocator = new AgentIdAllocator(() => active);

  const first = allocator.reserve('debug');
  allocator.release(first);

  assert.equal(allocator.reserve('debug'), 'debug');
});
