# Agent Army

Agent Army starts a manager-centric terminal UI and spawns Brainstorming, Implementation, Debug, and Tester specialists on demand.

```bash
npm install
node agent-army.js start
```

Enter objectives at the `[you]` prompt. The manager checks run-local context summaries, spawns or resumes specialists through Agent Army's local MCP server, closes specialists when their work is complete, and returns results in the manager UI.

Core commands:

```bash
node agent-army.js start
node agent-army.js attach
node agent-army.js status
node agent-army.js stop
```

On `start` and `attach`, the manager UI shows the live agent roster with `name`, `status`, `session id`, and `summary`. Inside tmux, Agent Army creates named specialist panes like `Agent Army: implementation`, `Agent Army: debug`, or `Agent Army: debug-2`; when specialists close, those panes are removed. `.agent-army/state.json` contains active sessions only, while `.agent-army/runs/<runId>.json` stores per-run config, spawn metadata, session IDs, and completed context summaries.

## Local Context System

Agent Army now keeps a local SQLite context database at `.agent-army/context.db`. The core hierarchy is `Organization -> Project -> Feature -> Implementation`. Each implementation stores the operational details agents need before issue work starts:

- one or more repos
- target identity such as an endpoint path or worker name
- exact run and test instructions
- an invocation example
- expected output and a verification check
- append-only attributed notes with `hint` or `verified` trust

Manage context directly from the CLI:

```bash
node agent-army.js context init
node agent-army.js context add-feature --organization Acme --project-key OPS --project-name Operations --name "Billing API"
node agent-army.js context add-implementation --project-key OPS --feature "Billing API" --name "Charge endpoint" --type api --target /v1/charges --repo api --run "npm run dev" --test "npm test -- charges" --invoke "curl -X POST /v1/charges" --expect "201 Created" --verify "response includes charge id" --status ready
node agent-army.js context add-note --entity-type implementation --entity-id 1 --author-type agent --author-id implementation-1 --trust-level verified --body "Reproduced in staging"
node agent-army.js context show implementation 1
```

Issue intake and readiness workflow:

```bash
node agent-army.js issue fetch OPS-101
node agent-army.js issue match OPS-101
node agent-army.js issue ready OPS-101 --implementation-id 1
```

`issue match` ranks candidate implementations using project metadata, feature names, target identity, and note evidence. Low-confidence or stale matches are flagged for confirmation instead of being silently attached. `issue ready` checks both implementation readiness and issue-specific reproduction completeness before declaring an issue `ready_for_debug`.
