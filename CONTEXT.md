# Agent Army

Agent Army coordinates a group of specialized Codex work sessions that collaborate on a shared objective.

## Language

**Agent**:
A named Codex work session with a defined job. Each **Agent** is isolated behind its own app-server.
_Avoid_: Worker, bot

**Agent Army**:
The group of **Agents** collaborating on one shared objective.
_Avoid_: Multi-agent session

**Manager Agent**:
The proactive **Agent** through which all communication between other **Agents** is routed. It can observe and message every **Agent** in the **Agent Army**, and acts when an **Agent** completes work, reports a blocker, or is idle while work is pending.
_Avoid_: Orchestrator Agent, Supervisor Agent

**Brainstorming Agent**:
The **Agent** responsible for exploring and refining an objective before downstream work begins.
_Avoid_: Planning Agent, Ideation Agent

**Handoff**:
A message from an **Agent** to the **Manager Agent** describing work, a request, or a blocker that may need routing to another **Agent**.
_Avoid_: Peer message, direct agent message

**Agent Status**:
The server-owned source of truth for an **Agent's** lifecycle. An **Agent Status** is starting, idle, working, blocked, completed, or failed; completed means ready for Manager review, not terminated.
_Avoid_: Agent state, availability

## Example Dialogue

**Developer**: Start an Agent Army for this feature.

**Agent Army**: The Manager Agent and Brainstorming Agent are ready.

**Implementation Agent**: Manager Agent, here is a Handoff requesting a test review.

**Manager Agent**: I routed the Handoff to the Testing Agent.

**Developer**: Why is the Implementation Agent not working?

**Manager Agent**: Its Agent Status is blocked, and I am resolving its Handoff.
