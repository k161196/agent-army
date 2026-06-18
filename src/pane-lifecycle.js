import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { attachAgentPane, closeAgentPane, sendInterruptKey } from './tmux-panes.js';

export function readPanes(panesFile) {
  if (!existsSync(panesFile)) return {};
  return JSON.parse(readFileSync(panesFile, 'utf8'));
}

export function writePanes(panesFile, panes) {
  if (Object.keys(panes).length) writeFileSync(panesFile, JSON.stringify(panes, null, 2));
  else rmSync(panesFile, { force: true });
}

export function mergePersistedPanes(panesFile, panes) {
  Object.assign(panes, readPanes(panesFile));
  return panes;
}

function isPaneEligible(name, state) {
  return Boolean(state?.agents?.[name]);
}

function pruneIneligiblePanes(state, panes, exec) {
  for (const name of Object.keys(panes)) {
    if (!isPaneEligible(name, state)) closeAgentPane(name, panes, exec);
  }
}

function eligibleAgentNames(state) {
  return Object.keys(state.agents ?? {}).filter(name => isPaneEligible(name, state));
}

export function attachInitialAgentPanes(state, { panesFile, target, exec, names }) {
  const panes = readPanes(panesFile);
  pruneIneligiblePanes(state, panes, exec);
  const eligible = eligibleAgentNames(state).filter(n => !names || names.includes(n));
  for (const name of eligible) {
    attachAgentPane(name, state, panes, target, exec);
  }
  if (!process.env.CMUX_WORKSPACE_ID && target && Object.keys(panes).length) {
    exec('tmux', ['select-layout', '-t', target, 'tiled']);
  }
  writePanes(panesFile, panes);
  return panes;
}

export function syncAgentPanes(state, panes, { panesFile, target, exec }) {
  mergePersistedPanes(panesFile, panes);
  pruneIneligiblePanes(state, panes, exec);
  for (const name of Object.keys(panes)) {
    if (!state.agents?.[name]) closeAgentPane(name, panes, exec);
  }
  for (const name of eligibleAgentNames(state)) {
    attachAgentPane(name, state, panes, target, exec, { refresh: false });
  }
  writePanes(panesFile, panes);
  return panes;
}

export function attachLifecycleAgentPane(name, state, { panesFile, target, exec }) {
  const panes = readPanes(panesFile);
  if (!isPaneEligible(name, state)) {
    pruneIneligiblePanes(state, panes, exec);
    writePanes(panesFile, panes);
    return undefined;
  }
  const pane = attachAgentPane(name, state, panes, target, exec);
  writePanes(panesFile, panes);
  return pane;
}

export function closeLifecycleAgentPane(name, { panesFile, exec }) {
  const panes = readPanes(panesFile);
  const closed = closeAgentPane(name, panes, exec);
  writePanes(panesFile, panes);
  return closed;
}

export function interruptLifecycleAgentPane(name, { panesFile, exec }) {
  return sendInterruptKey(name, readPanes(panesFile), exec);
}
