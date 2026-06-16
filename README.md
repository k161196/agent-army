# Agent Army

Agent Army starts a Manager Codex session and lets it spawn Brainstorming, Implementation, Debug, and Tester specialist sessions on demand.

```bash
npm install
node agent-army.js start
```

Enter objectives at the `[you]` prompt. The Manager checks run-local context summaries, spawns or resumes specialist context through Agent Army's local MCP server, closes specialists when their work is complete, and returns the result.

Commands:

```bash
node agent-army.js start
node agent-army.js attach
node agent-army.js status
node agent-army.js stop
```

Inside tmux, `start` initially creates an interactive pane for the Manager session. As the Manager spawns specialists, Agent Army creates named panes such as `Agent Army: implementation`, `Agent Army: debug`, or `Agent Army: debug-2`; when specialists are closed, their panes are removed. Outside tmux, it prints attach commands for active sessions. `.agent-army/state.json` contains active sessions only, while `.agent-army/runs/<runId>.json` stores per-run config, spawn metadata, session IDs, and completed context summaries.
