# Phase One

Phase one proves that a Manager Agent can coordinate a Brainstorming Agent while both remain visible and interactive in tmux.

## Acceptance Scenario

1. The user runs one Agent Army command inside tmux.
2. The server starts isolated app-servers for the Manager Agent and Brainstorming Agent.
3. The command creates one tmux split per Agent and attaches its Codex session.
4. The user sends an objective to the Manager Agent from the original command terminal.
5. The Manager Agent delegates the objective to the Brainstorming Agent.
6. The Brainstorming Agent returns a Handoff to the Manager Agent.
7. The Manager Agent returns a synthesized result to the user.
8. Both Agent panes visibly show their activity throughout the workflow.

## Boundaries

- Phase one contains only the Manager Agent and Brainstorming Agent.
- Each Agent has its own app-server and port.
- All inter-agent communication routes through the Manager Agent.
- The Manager Agent coordinates through structured server tools rather than free-form output parsing.
- Codex built-in child agents are disabled so Manager delegation cannot bypass the named Agent Army sessions.
- The server owns Agent Status.
- Completed Agents remain available for follow-up work until the Agent Army stops.

## Manager Tools

- `send_agent_message(agent, message)` sends work or a follow-up to a named Agent.
- `get_agent_status(agent)` returns the named Agent's current Agent Status.
- `list_agent_messages(agent)` returns messages associated with the named Agent.

The Agent Army server exposes these tools through a local MCP server configured only for the Manager Agent.

## Agent Tools

- `report_status(status, message)` reports completion, a blocker, or other meaningful progress to the Manager Agent.

The Brainstorming Agent can only access `report_status`; it cannot route messages or inspect other Agents.

## Manager Inbox

Reports from Agents are delivered to a server-owned Manager inbox. When the Manager Agent is idle, a report immediately starts a Manager turn; while the Manager Agent is working, reports wait in the inbox and are delivered serially after the current turn completes.

User messages enter the same serialized inbox. After the active Manager turn completes, the oldest queued user message is delivered before queued Agent reports; Agent reports preserve their order relative to one another.

## Agent Panes

Each Agent pane is visible and interactive. Direct interaction is an escape hatch for debugging or intervention: messages typed directly into an Agent pane bypass the Manager inbox and are not guaranteed to be visible to the coordination logic. Normal user work enters through the original Agent Army terminal.

When started inside tmux, Agent Army creates one pane per Agent. When started outside tmux, Agent Army continues headlessly and prints an attach command for each Agent session.

Codex app-server sends live turn events only to the connection that starts a turn. Agent Army refreshes attached panes after each coordinated Manager response so they reload persisted activity.

## Lifecycle

Agent Army persists after the original command exits. `attach` reconnects to the existing army, `status` prints its sessions, and `stop` terminates the server and both Agent app-servers. Starting while an army is already running attaches to that army rather than creating another one.
