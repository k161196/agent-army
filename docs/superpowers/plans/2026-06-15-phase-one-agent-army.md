# Phase One Agent Army Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable two-agent army where a Manager delegates user objectives to a Brainstorming Agent and returns its report.

**Architecture:** A central Node.js server owns Agent status, queues, and HTTP tool endpoints. It starts one Codex app-server per Agent, connects as a JSON-RPC client, and exposes role-scoped tools through a local stdio MCP server. The CLI starts, attaches to, and stops the persistent server, creating tmux panes when available.

**Tech Stack:** Node.js, built-in HTTP/test modules, `ws`, Codex app-server JSON-RPC, MCP over stdio, tmux.

---

## File Structure

- `src/agent.js`: one app-server connection and serialized turn queue.
- `src/army.js`: two-agent coordination, Manager inbox, status, and tool behavior.
- `src/server.js`: persistent HTTP server, process lifecycle, state file, and tmux attachment.
- `src/mcp-server.js`: role-scoped MCP stdio tools.
- `agent-army.js`: user-facing `start`, `attach`, and `stop` CLI.
- `test/army.test.js`: coordination and queue behavior tests.
- `test/mcp-server.test.js`: MCP tool boundary tests.

## Tasks

- [x] Add failing tests for serialized Agent turns and user-priority Manager inbox behavior.
- [x] Implement Agent and Army coordination until those tests pass.
- [x] Add failing tests for Manager-only routing tools and restricted Agent reporting.
- [x] Implement the MCP stdio server and HTTP tool routes until those tests pass.
- [x] Implement persistent CLI lifecycle, dynamic ports, and tmux/headless attachment.
- [x] Run automated tests and a real two-agent smoke test against Codex app-server.
- [x] Reconcile documentation with verified behavior.
