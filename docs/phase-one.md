# Phase One

Phase one proves that a Manager Agent can coordinate specialist Agents while each session remains visible and interactive in tmux.

## Acceptance Scenario

1. The user runs one Agent Army command inside tmux.
2. The server starts an isolated app-server for the Manager Agent and creates a fresh per-run metadata file.
3. The command creates one named tmux split for the Manager Agent and attaches its Codex session.
4. The user sends an objective to the Manager Agent from the original command terminal.
5. The Manager Agent reviews completed context summaries, spawns the appropriate specialist Agent, and delegates the objective.
6. Agent Army creates a named pane for the spawned specialist.
7. Specialist Agents report results back to the Manager Agent.
8. The Manager Agent closes specialists that are no longer needed, recording concise summaries/session IDs, then returns a synthesized result to the user.

## Boundaries

- Phase one contains Manager, Brainstorming, Implementation, Debug, and Tester Agents.
- Each active Agent has its own app-server and port.
- A specialist type may have more than one active runtime Agent instance; ids such as `debug` and `debug-2` identify the instances.
- All inter-agent communication routes through the Manager Agent.
- The Manager Agent coordinates through structured server tools rather than free-form output parsing.
- Codex built-in child agents are disabled so Manager delegation cannot bypass the named Agent Army sessions.
- The server owns Agent Status.
- Inactive specialists are represented as `not_started`; closed specialists keep run metadata but no live process.
- Completed context summaries are per script run and are stored separately from the active attach state.

## Manager Tools

- `spawn_agent(agent, agentId, title, taskId, contextKey, resumeSessionId, contextSummary)` starts a specialist Agent type and returns `agentId`, the runtime id to use for follow-up tools. `agentId` is optional; Agent Army generates one when omitted. When `resumeSessionId` is supplied, Agent Army resumes context in a fresh thread by injecting the prior summary/session ID.
- `close_agent(agent, summary, title, contextKey, status)` closes an active runtime Agent id and records optional summary metadata.
- `list_run_agents()` returns active and historical Agent records for the current run.
- `list_completed_contexts()` returns completed context summaries and session IDs recorded in the current run.
- `record_task_summary(contextKey, title, summary, agentSessions)` records a cross-agent completed context summary.
- `send_agent_message(agent, message)` sends work or a follow-up to a runtime Agent id.
- `get_agent_status(agent)` returns the runtime Agent's current Agent Status.
- `list_agent_messages(agent)` returns messages associated with the runtime Agent.

The Agent Army server exposes these tools through a local MCP server configured only for the Manager Agent.

## Agent Tools

- `report_status(status, message)` reports completion, a blocker, or other meaningful progress to the Manager Agent.

Specialist Agents can only access `report_status`; they cannot route messages or inspect other Agents.

## Specialist Roles

- Brainstorming explores ideas, plans work, writes handoff documents, and validates implementation learnings.
- Implementation reads a handoff document, applies the requested code/docs/test changes, runs verification, and reports learnings.
- Debug investigates bugs, failing tests, runtime errors, regressions, and unexpected behavior; it gathers evidence, applies scoped fixes when requested, and reports verification.
- Tester verifies real behavior broadly by running tests, checking APIs and CLIs, performing smoke checks, and reporting evidence and coverage gaps.

## Manager Inbox

Reports from Agents are delivered to a server-owned Manager inbox. When the Manager Agent is idle, a report immediately starts a Manager turn; while the Manager Agent is working, reports wait in the inbox and are delivered serially after the current turn completes.

User messages enter the same serialized inbox. After the active Manager turn completes, the oldest queued user message is delivered before queued Agent reports; Agent reports preserve their order relative to one another.

## Agent Panes

Each active Agent pane is visible and interactive. Direct interaction is an escape hatch for debugging or intervention: messages typed directly into an Agent pane bypass the Manager inbox and are not guaranteed to be visible to the coordination logic. Normal user work enters through the original Agent Army terminal.

When started inside tmux, Agent Army creates one pane for the Manager and creates specialist panes as the Manager spawns them. Panes are named with runtime ids, such as `Agent Army: debug` and `Agent Army: debug-2`. When started outside tmux, Agent Army continues headlessly and prints attach commands for active Agent sessions.

Codex app-server sends live turn events only to the connection that starts a turn. Agent Army syncs panes after each coordinated Manager response so newly active specialists are attached and closed specialists are removed.

## Lifecycle

Agent Army persists after the original command exits. `attach` reconnects to the existing army, `status` prints active sessions, and `stop` terminates the server and active Agent app-servers. Starting while an army is already running attaches to that army rather than creating another one. `.agent-army/state.json` is active-only; `.agent-army/runs/<runId>.json` stores per-run config, spawn/close metadata, session IDs, and completed context summaries.
