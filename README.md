# Agent Army

Phase one runs a Manager Agent and Brainstorming Agent as isolated, persistent Codex sessions.

```bash
npm install
node agent-army.js start
```

Enter objectives at the `[you]` prompt. The Manager delegates brainstorming through Agent Army's local MCP server and returns the result.

Commands:

```bash
node agent-army.js start
node agent-army.js attach
node agent-army.js status
node agent-army.js stop
```

Inside tmux, `start` creates interactive panes attached to both Agent sessions. Codex app-server does not broadcast live turns to other attached clients, so Agent Army automatically refreshes these panes after each coordinated Manager response to load persisted activity. Outside tmux, it prints the commands needed to attach manually. The server and Agent sessions persist after the original terminal exits until `stop` is run.
