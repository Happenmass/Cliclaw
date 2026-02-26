# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is CLIPilot

CLIPilot is a TUI meta-orchestrator that commands coding agents (like Claude Code) via tmux. It does not write code directly — it plans tasks, launches agents in tmux panes, monitors their state, and makes decisions through an LLM-driven tool-use loop.

Core flow: **Goal → Planner → TaskGraph → Scheduler → MainAgent (tool-use loop) → Agent execution in tmux**

## Commands

```bash
npm run build          # tsc — compile to dist/
npm run dev            # tsc --watch
npm test               # vitest run — all tests
npm run test:watch     # vitest — watch mode
npx vitest test/core/main-agent.test.ts   # run a single test file
npm run check          # biome check src/
npm run format         # biome format --write src/
npm start              # node dist/main.js
```

## Code Style

- **Formatter**: Biome — tabs, indent width 3, line width 120
- **Module system**: ESM (`"type": "module"` in package.json)
- **TypeScript**: strict mode, target ES2022, module Node16
- **Imports**: use `.js` extension in relative imports (Node16 module resolution)
- `noExplicitAny: off`, `noNonNullAssertion: off` — these are intentionally relaxed
- Use `useConst: error` — always prefer `const`

## Architecture

### Initialization (`src/main.ts`)
Entry point. Parses CLI args, loads config/memory, initializes all components, runs the 3-phase flow:
1. **Planning** — `Planner.plan()` uses LLM to generate a `TaskGraph` from the user's goal
2. **Execution** — `Scheduler` iterates ready tasks, delegates each to `MainAgent`
3. **Summary** — Session summary and memory persistence

### MainAgent (`src/core/main-agent.ts`)
Central decision engine using LLM tool-use. Runs a loop: call LLM → extract tool calls → execute tools → repeat until a terminal tool is called. Six tools:
- `send_to_agent` / `respond_to_agent` — interact with the coding agent in tmux
- `fetch_more` — capture more tmux pane content
- `mark_complete` / `mark_failed` — terminal: end the task
- `request_replan` / `escalate_to_human` — terminal: request intervention

### SignalRouter (`src/core/signal-router.ts`)
Aggregates StateDetector results into typed signals (`TASK_READY`, `DECISION_NEEDED`, `NOTIFY`). The MainAgent waits on these signals between tool-use rounds.

### StateDetector (`src/tmux/state-detector.ts`)
Polls tmux pane content, computes content hashes, and classifies agent state (active, waiting_input, completed, error) using pattern matching. Falls back to LLM analysis for ambiguous states. Has a cooldown mechanism to avoid excessive polling.

### ContextManager (`src/core/context-manager.ts`)
Modular system prompt construction. Manages replaceable sections (goal, task_graph_summary, compressed_history, memory). Supports LLM-based history compression when context exceeds 70% threshold.

### LLM Layer (`src/llm/`)
- `client.ts` — unified client supporting Anthropic and OpenAI-compatible protocols
- `providers/registry.ts` — 12 built-in providers (OpenAI, Anthropic, DeepSeek, Gemini, Groq, etc.)
- `prompt-loader.ts` — loads markdown prompt templates from `src/prompts/` with `{{variable}}` interpolation

### Prompts (`src/prompts/`)
Markdown templates with `{{variable}}` placeholders. Key files: `main-agent.md` (MainAgent system prompt), `planner.md`, `state-analyzer.md`, `history-compressor.md`.

### Other Components
- `TmuxBridge` (`src/tmux/bridge.ts`) — tmux command wrapper (create sessions, send keys, capture panes)
- `Planner` (`src/core/planner.ts`) — LLM-driven task planning, outputs TaskGraph
- `Task` (`src/core/task.ts`) — TaskGraph data structure with dependency tracking
- `Memory` (`src/core/memory.ts`) — project-scoped persistent memory at `~/.clipilot/memory/`
- `Session` (`src/core/session.ts`) — session lifecycle management
- `ClaudeCodeAdapter` (`src/agents/claude-code.ts`) — agent adapter for Claude Code

## Testing

Tests live in `test/` mirroring `src/` structure. All tests mock external dependencies (LLM calls, tmux commands). The integration test (`test/core/integration.test.ts`) validates the full Goal → Plan → Execute pipeline with mocked components.

## Config

User config at `~/.clipilot/config.json`. Managed via `src/utils/config.ts`. The `clipilot config` subcommand opens a TUI editor. The `clipilot doctor` subcommand checks environment prerequisites (tmux, node version, API keys).
