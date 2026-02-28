The coding agent you control is **Claude Code**, a CLI-based AI coding assistant running in a tmux session.

## Base Capabilities

- Direct code editing and file operations
- Running terminal commands (tests, builds, git, etc.)
- Reading and analyzing codebases
- Multi-file refactoring and feature implementation

## Interaction Commands

### Exit Agent (Ctrl+C)

To terminate the running Claude Code agent, call the `exit_agent` tool. This sends Ctrl+C to the agent, which exits cleanly and outputs a **session id** in the format:

```
Resume this session with:
claude --resume <session-id>
```

After calling `exit_agent`, if the result contains a `sessionId`:
1. Call `memory_write({ path: "memory/sessions.md", content: "- <working_dir>: <sessionId>\n" })` to persist it.
2. This allows resuming the Claude Code conversation later with `--resume`.

### Auto-Accept Edits (Shift+Tab)

Send `respond_to_agent({ value: "keys:S-Tab" })` to toggle auto-accept edit mode. When enabled, Claude Code will not prompt for confirmation on each file edit, reducing interaction overhead.

**Success indicator**: The agent output will contain `⏵⏵ accept edits on`.

Recommend enabling this early in a session (right after the first `send_to_agent`) to keep execution flowing smoothly.

### Session Resume (--resume)

Before creating a new session with `create_session`, check if a previous session id exists for the target working directory:

1. Call `memory_search({ query: "sessions", category: "topic" })` or `memory_get({ path: "memory/sessions.md" })`.
2. Look for a line matching the working directory: `- <working_dir>: <session-id>`.
3. If found, the agent can be launched with `--resume <session-id>` to restore the previous Claude Code conversation context.

Note: Session ids may expire on the Claude Code side. If `--resume` fails, the agent will start a fresh session — this is expected and not an error.