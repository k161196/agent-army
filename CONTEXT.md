# Agent Army

Agent Army coordinates a group of specialized Codex work sessions that collaborate on a shared objective.

Current specialist types are Manager, Brainstorming, Implementation, Debug, and Tester. A runtime **Agent** instance also has a unique id, such as `debug` or `debug-2`.

## Language

**Agent**:
A runtime Codex session with a specialist type and a unique runtime id. Active **Agents** are isolated behind their own app-server; inactive specialist types remain known to the **Manager Agent** until spawned. For example, `debug` and `debug-2` can both be Debug Agent instances in one run.
_Avoid_: Worker, bot

**Agent Army**:
The group of **Agents** collaborating on one shared objective.
_Avoid_: Multi-agent session

**Manager Agent**:
The proactive **Agent** through which all communication between other **Agents** is routed. It starts first, inspects completed context summaries, spawns specialist **Agents** when needed, closes them after useful work, and acts when an **Agent** completes work, reports a blocker, or is idle while work is pending.
_Avoid_: Orchestrator Agent, Supervisor Agent

**Brainstorming Agent**:
The **Agent** responsible for exploring and refining an objective before downstream work begins.
_Avoid_: Planning Agent, Ideation Agent

**Implementation Agent**:
The **Agent** responsible for applying a written handoff by editing code/docs/tests, running commands, and reporting implementation learnings.
_Avoid_: Builder, Coder

**Debug Agent**:
The **Agent** responsible for investigating bugs, failing tests, runtime errors, regressions, and unexpected behavior.
_Avoid_: Fixer, Troubleshooter

**Tester Agent**:
The **Agent** responsible for broad practical verification: running tests, checking APIs and CLIs, smoke testing behavior, and reporting evidence-backed coverage gaps.
_Avoid_: QA bot, Testing Agent

**Handoff**:
A message from an **Agent** to the **Manager Agent** describing work, a request, or a blocker that may need routing to another **Agent**.
_Avoid_: Peer message, direct agent message

**Agent Status**:
The server-owned source of truth for a runtime **Agent's** lifecycle. An **Agent Status** is not_started, starting, idle, working, blocked, completed, failed, or closed; completed means ready for Manager review, while closed means the live app-server was stopped and only run metadata remains.
_Avoid_: Agent state, availability

**Completed Context**:
A per-run summary of finished work with relevant **Agent** session IDs. The **Manager Agent** reviews **Completed Contexts** before deciding whether to spawn a fresh specialist or resume context from a prior specialist session.
_Avoid_: Global memory, permanent history

## Example Dialogue

**Developer**: Start an Agent Army for this feature.

**Agent Army**: The Manager Agent is ready and can spawn Brainstorming, Implementation, Debug, and Tester Agents as needed.

**Implementation Agent**: Manager Agent, here is a Handoff requesting a test review.

**Manager Agent**: I routed the Handoff to the Tester Agent.

**Developer**: Why is the Implementation Agent not working?

**Manager Agent**: Its Agent Status is blocked, and I am resolving its Handoff.
