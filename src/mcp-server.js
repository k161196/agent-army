#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { toolDefinitions, callTool } from './tools.js';

const role = process.env.AGENT_ARMY_ROLE;
const api = process.env.AGENT_ARMY_API;

async function request(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return text ? JSON.parse(text) : { ok: true };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (message.id === undefined) return;
  try {
    let result;
    switch (message.method) {
      case 'initialize':
        result = {
          protocolVersion: message.params?.protocolVersion ?? '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'agent-army', version: '0.1.0' },
        };
        break;
      case 'tools/list':
        result = { tools: toolDefinitions(role) };
        break;
      case 'tools/call': {
        const value = await callTool(role, message.params.name, message.params.arguments ?? {}, request);
        result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
        break;
      }
      default:
        throw new Error(`method not found: ${message.method}`);
    }
    send({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } });
  }
}

createInterface({ input: process.stdin }).on('line', line => {
  try {
    handle(JSON.parse(line));
  } catch (error) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } });
  }
});
