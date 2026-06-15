function attachCommand(name, agent) {
  return `printf '\\033]2;${name}\\033\\\\'; echo 'Direct interaction bypasses Agent Army coordination.'; codex resume --remote ws://127.0.0.1:${agent.port} ${agent.threadId}`;
}

export function attachAgentPanes(state, target, exec) {
  if (!target) return {};
  const panes = {};
  for (const [name, agent] of Object.entries(state.agents)) {
    panes[name] = exec('tmux', [
      'split-window',
      '-d',
      '-P',
      '-F',
      '#{pane_id}',
      '-t',
      target,
      '-c',
      state.cwd,
      attachCommand(name, agent),
    ]).trim();
  }
  exec('tmux', ['select-layout', '-t', target, 'tiled']);
  return panes;
}

export function refreshAgentPanes(state, panes, exec) {
  for (const [name, pane] of Object.entries(panes)) {
    const agent = state.agents[name];
    if (!agent) continue;
    exec('tmux', ['respawn-pane', '-k', '-t', pane, '-c', state.cwd, attachCommand(name, agent)]);
  }
}

export function refreshPane(name, state, panes, exec) {
  const pane = panes[name];
  const agent = state.agents[name];
  if (!pane || !agent) return;
  exec('tmux', ['respawn-pane', '-k', '-t', pane, '-c', state.cwd, attachCommand(name, agent)]);
}
