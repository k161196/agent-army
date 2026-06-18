# Agent Army

Agent Army starts a manager-centric terminal UI and keeps that manager session as the primary interaction surface while it spawns Brainstorming, Implementation, Debug, and Tester specialists on demand.

```bash
npm install
node agent-army.js start
```

Enter objectives at the `[you]` prompt. The manager checks run-local context summaries, spawns or resumes specialists through Agent Army's local MCP server, closes specialists when their work is complete, and returns results in the manager UI.

Commands:

```bash
node agent-army.js start
node agent-army.js attach
node agent-army.js status
node agent-army.js stop
```

On `start` and `attach`, the manager UI shows a live agent roster with `name`, `status`, `session id`, and `summary`, then keeps the `[you]` prompt visible for continued manager interaction.

Inside tmux, Agent Army still creates named specialist panes like `Agent Army: implementation`, `Agent Army: debug`, or `Agent Army: debug-2`; when specialists close, those panes are removed.

`.agent-army/state.json` contains active sessions only, while `.agent-army/runs/<runId>.json` stores per-run config, spawn metadata, session IDs, and completed context summaries.
