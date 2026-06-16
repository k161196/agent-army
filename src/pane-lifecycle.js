import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { attachAgentPane, closeAgentPane } from './tmux-panes.js';

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

export function attachInitialAgentPanes(state, { panesFile, target, exec }) {
  const panes = readPanes(panesFile);
  for (const name of Object.keys(state.agents ?? {})) {
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
  for (const name of Object.keys(panes)) {
    if (!state.agents?.[name]) closeAgentPane(name, panes, exec);
  }
  for (const name of Object.keys(state.agents ?? {})) {
    attachAgentPane(name, state, panes, target, exec);
  }
  writePanes(panesFile, panes);
  return panes;
}

export function attachLifecycleAgentPane(name, state, { panesFile, target, exec }) {
  const panes = readPanes(panesFile);
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
