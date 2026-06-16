function attachCommand(name, agent) {
  const bin = process.env.CODEX_BIN ?? 'codex';
  const title = `Agent Army: ${name}`;
  return `printf '\\033]2;${title}\\033\\\\'; echo 'Direct interaction bypasses Agent Army coordination.'; ${bin} resume --remote ws://127.0.0.1:${agent.port} ${agent.threadId}`;
}

// --- tmux ---

export function attachAgentPanes(state, target, exec) {
  if (process.env.CMUX_WORKSPACE_ID) return attachAgentPanesCmux(state, exec);
  if (!target) return {};
  const panes = {};
  for (const [name, agent] of Object.entries(state.agents)) {
    panes[name] = attachAgentPane(name, state, panes, target, exec);
  }
  if (Object.keys(panes).length) exec('tmux', ['select-layout', '-t', target, 'tiled']);
  return panes;
}

export function attachAgentPane(name, state, panes, target, exec) {
  if (process.env.CMUX_WORKSPACE_ID) return attachAgentPaneCmux(name, state, panes, exec);
  const agent = state.agents[name];
  if (!target || !agent) return undefined;
  if (panes[name]) {
    refreshPane(name, state, panes, exec);
    return panes[name];
  }
  const direction = name === 'manager' ? '-v' : '-h';
  const pane = exec('tmux', [
    'split-window', direction, '-d', '-P', '-F', '#{pane_id}',
    '-t', target, '-c', state.cwd, attachCommand(name, agent),
  ]).trim();
  exec('tmux', ['select-pane', '-t', pane, '-T', `Agent Army: ${name}`]);
  panes[name] = pane;
  return pane;
}

export function refreshPane(name, state, panes, exec) {
  if (process.env.CMUX_WORKSPACE_ID) return refreshPaneCmux(name, state, panes, exec);
  const pane = panes[name];
  const agent = state.agents[name];
  if (!pane || !agent) return;
  exec('tmux', ['respawn-pane', '-k', '-t', pane, '-c', state.cwd, attachCommand(name, agent)]);
  exec('tmux', ['select-pane', '-t', pane, '-T', `Agent Army: ${name}`]);
}

// kept for back-compat
export function refreshAgentPanes(state, panes, exec) {
  for (const [name] of Object.entries(state.agents)) {
    refreshPane(name, state, panes, exec);
  }
}

export function closeAgentPane(name, panes, exec) {
  if (process.env.CMUX_WORKSPACE_ID) return closeAgentPaneCmux(name, panes, exec);
  const pane = panes[name];
  if (!pane) return false;
  try { exec('tmux', ['kill-pane', '-t', pane]); } catch { /* already closed */ }
  delete panes[name];
  return true;
}

export function sendInterruptKey(name, panes, exec) {
  const pane = panes[name];
  if (!pane) return { ok: false, reason: 'no pane is attached; retry without interrupt or attach panes first' };
  try {
    if (process.env.CMUX_WORKSPACE_ID) {
      exec('cmux', ['send-key', '--surface', pane, 'escape']);
    } else {
      exec('tmux', ['send-keys', '-t', pane, 'Escape']);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `failed to send interrupt to ${pane}: ${error.message}` };
  }
}

// --- cmux ---

function cmuxPaneRefs(exec) {
  try {
    const out = exec('cmux', ['list-panes', '--json']);
    return JSON.parse(out).panes ?? [];
  } catch { return []; }
}

function cmuxSurfaceRefs(workspaceId, exec) {
  try {
    const out = exec('cmux', ['list-pane-surfaces', '--workspace', workspaceId, '--json']);
    const value = JSON.parse(out);
    return Array.isArray(value) ? value : value.surfaces ?? [];
  } catch { return []; }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cmuxAgentTabName(name, surfaces) {
  const pattern = new RegExp(`^${escapeRegExp(name)}(?:-(\\d+))?$`);
  const counts = surfaces
    .map(surface => surface.title ?? surface.name ?? surface.label ?? '')
    .map(title => pattern.exec(title))
    .filter(Boolean)
    .map(match => match[1] ? Number(match[1]) : 1);
  if (!counts.length) return name;
  return `${name}-${Math.max(...counts) + 1}`;
}

function cmuxExistingOrNextAgentTabName(name, surfaceRef, workspaceId, exec) {
  const surfaces = cmuxSurfaceRefs(workspaceId, exec);
  const current = surfaces.find(surface => surface.ref === surfaceRef);
  const currentTitle = current?.title ?? current?.name ?? current?.label ?? '';
  if (new RegExp(`^${escapeRegExp(name)}(?:-\\d+)?$`).test(currentTitle)) return currentTitle;
  return cmuxAgentTabName(name, surfaces.filter(surface => surface.ref !== surfaceRef));
}

function renameCmuxTab(surfaceRef, title, exec) {
  try {
    exec('cmux', ['rename-tab', '--surface', surfaceRef, title]);
  } catch {
    exec('cmux', ['tab-action', '--action', 'rename', '--surface', surfaceRef, '--title', title]);
  }
}

function attachAgentPanesCmux(state, exec) {
  const panes = {};
  for (const [name, agent] of Object.entries(state.agents)) {
    attachAgentPaneCmux(name, state, panes, exec);
  }
  return panes;
}

function attachAgentPaneCmux(name, state, panes, exec) {
  const workspaceId = process.env.CMUX_WORKSPACE_ID;
  const agent = state.agents[name];
  if (!workspaceId || !agent) return undefined;
  if (panes[name]) {
    refreshPaneCmux(name, state, panes, exec);
    return panes[name];
  }
  const before = new Set(cmuxPaneRefs(exec).map(p => p.ref));
  const direction = name === 'manager' ? 'down' : 'right';
  exec('cmux', ['new-pane', '--workspace', workspaceId, '--type', 'terminal', '--direction', direction, '--focus', 'false']);
  const after = cmuxPaneRefs(exec);
  const newPane = after.find(p => !before.has(p.ref));
  if (!newPane) return undefined;
  const surfaceRef = newPane.surface_refs?.[0];
  if (!surfaceRef) return undefined;
  renameCmuxTab(surfaceRef, cmuxAgentTabName(name, cmuxSurfaceRefs(workspaceId, exec)), exec);
  exec('cmux', ['send', '--surface', surfaceRef, `${attachCommand(name, agent)}\n`]);
  panes[name] = surfaceRef;
  return surfaceRef;
}

function refreshPaneCmux(name, state, panes, exec) {
  const workspaceId = process.env.CMUX_WORKSPACE_ID;
  const surfaceRef = panes[name];
  const agent = state.agents[name];
  if (!surfaceRef || !agent) return;
  renameCmuxTab(surfaceRef, cmuxExistingOrNextAgentTabName(name, surfaceRef, workspaceId, exec), exec);
  try { exec('cmux', ['send-key', '--surface', surfaceRef, 'ctrl+c']); } catch { /* ignore */ }
  try { exec('cmux', ['send', '--surface', surfaceRef, '/exit\n']); } catch { /* ignore */ }
  exec('cmux', ['send', '--surface', surfaceRef, `${attachCommand(name, agent)}\n`]);
}

function closeAgentPaneCmux(name, panes, exec) {
  const surfaceRef = panes[name];
  if (!surfaceRef) return false;
  try { exec('cmux', ['close-surface', '--surface', surfaceRef]); } catch { /* already closed */ }
  delete panes[name];
  return true;
}
