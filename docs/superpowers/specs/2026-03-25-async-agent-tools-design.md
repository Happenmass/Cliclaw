# Async Agent Tools Design

## Problem

`send_to_agent` and `respond_to_agent` block the MainAgent's execution loop by synchronously awaiting `stateDetector.waitForSettled()`. During this time, MainAgent cannot respond to user messages — they are queued in MessageQueue and only processed between tool rounds. This makes the chat interface unresponsive whenever a sub-agent is working.

## Solution

Make `send_to_agent` and `respond_to_agent` non-blocking. Extract sub-agent lifecycle monitoring into a new `SessionMonitor` module. Sub-agent state changes (completion, error, waiting for input) are delivered back to MainAgent as callback messages via the existing `handleMessage` entry point.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool loop changes | Keep tool loop unchanged | Only agent interaction tools need async; other tools (exec_command, memory) are fast and benefit from sync execution |
| State management granularity | Per-session | Each tmux session is a physically isolated agent process; one active task per session |
| Callback delivery | Unified via `handleMessage` | Callbacks are semantically "a message with context"; reusing the existing entry point avoids a parallel channel and lets LLM process them naturally |
| Monitoring approach | Per-task background polling | Wraps existing `waitForSettled` in a fire-and-forget async loop; avoids global scheduler complexity |
| Module extraction | New `SessionMonitor` class | `main-agent.ts` is 1400+ lines; session monitoring is an orthogonal concern that benefits from separation |
| Callback content | Fixed 100 lines of pane content | Simple, consistent, matches current `capturePane` behavior; LLM can use `inspect_session` for more |

## Architecture

### Module Responsibilities

```
MainAgent (src/core/main-agent.ts)
├── Chat decision engine (IDLE ↔ EXECUTING state machine)
├── Tool execution loop (unchanged)
├── Holds SessionMonitor instance
└── Tools: dispatch tasks, check busy, return immediately

SessionMonitor (src/core/session-monitor.ts)  [NEW]
├── Task lifecycle (register / query / cleanup)
├── Per-session busy state
├── Per-task background polling (reuses StateDetector)
├── Callback message construction
└── Notifies MainAgent via injected onCallback function

StateDetector (src/tmux/state-detector.ts)  [unchanged]
└── Reused by SessionMonitor for waitForSettled polling
```

### Integration

```typescript
// MainAgent constructor
this.sessionMonitor = new SessionMonitor({
  stateDetector: this.stateDetector,
  bridge: this.bridge,
  onCallback: (message: string) => {
    this.handleMessage(message);
  },
});
```

SessionMonitor does not depend on MainAgent. It communicates outward solely through the `onCallback` function injected at construction time.

## SessionMonitor Internal Design

### Data Structures

```typescript
interface TaskInfo {
  taskId: string;              // Unique ID, e.g. "task_<nanoid>"
  sessionId: string;           // Owning session
  type: "prompt" | "response"; // Dispatch type
  status: "running" | "waiting_input"; // Task state (settled tasks are removed)
  preHash: string;             // Pane content hash before dispatch
  startedAt: number;           // Timestamp
  abortController: { aborted: boolean }; // Per-task abort flag
}

interface BusyResult {
  busy: true;
  sessionId: string;
  currentTask: TaskInfo;
  paneContent: string;         // Latest 100 lines
}
```

Storage: `Map<string, TaskInfo>` keyed by sessionId. One active task per session enforces mutual exclusion.

### Interface

```typescript
class SessionMonitor {
  constructor(opts: {
    stateDetector: StateDetector;
    bridge: TmuxBridge;
    onCallback: (message: string) => void;
  });

  dispatch(sessionId: string, paneTarget: string, preHash: string): TaskInfo | BusyResult;
  resumeTask(sessionId: string, newPreHash: string): void;
  isBusy(sessionId: string): boolean;
  getTask(sessionId: string): TaskInfo | null;
  getAllTasks(): TaskInfo[];
  cleanup(sessionId: string): void;
  shutdown(): void;
}
```

### Background Polling Lifecycle

```
dispatch() called
  → isBusy? → yes: return BusyResult with 100 lines of pane content
  → Create TaskInfo, store in Map
  → Fire-and-forget async polling loop:
      → stateDetector.waitForSettled(paneTarget, { preHash, isAborted })
      → On settle:
          if waiting_input:
            → Update task status to "waiting_input"
            → Fire callback (status=waiting_input)
            → Pause polling (wait for resumeTask)
          if completed/error/timeout:
            → Capture 100 lines of pane content
            → Collect workspace evidence
            → Fire callback (status=completed/error/timeout)
            → Remove task from Map
      → On exception:
          → Fire callback with error info
          → Remove task from Map
  → Return TaskInfo immediately (do not await polling)
```

### resumeTask Flow

Called by `respond_to_agent` after sending keys:

```
resumeTask(sessionId, newPreHash)
  → Get task from Map (must be in waiting_input status)
  → Update preHash to newPreHash
  → Set status back to "running"
  → Restart async polling loop with new preHash
```

### Task State Transitions

```
             dispatch()
                │
                ▼
            ┌────────┐
            │running  │◄──── resumeTask()
            └────┬───┘          ▲
                 │               │
        waitForSettled()         │
                 │               │
         ┌───────┴────────┐     │
         ▼                ▼     │
  ┌──────────────┐  ┌──────────────────┐
  │waiting_input │──┤ respond_to_agent  │
  └──────────────┘  └──────────────────┘
         │
         │ (also possible: timeout while waiting)
         ▼
  ┌────────────┐
  │  settled   │ → fire callback → remove from Map
  └────────────┘
  (completed / error / timeout)
```

## Tool Behavior Changes

### send_to_agent (modified)

```
1. resolveSession(session_id)
2. sessionMonitor.isBusy(sessionId)
   → Busy: return current task info + 100 lines of agent logs
   → Free: continue
3. captureHash(paneTarget) → preHash
4. adapter.sendPrompt(bridge, paneTarget, prompt)
5. sessionMonitor.dispatch(sessionId, paneTarget, preHash) → taskInfo
6. Return immediately:
   "Task dispatched. task_id: <id>, session: <id>.
    You will receive a callback when the agent finishes."
```

Busy response:
```
"Session <id> is busy (task_id: <id>, running for <N>s).
 Current agent logs:
 <100 lines of pane content>"
```

### respond_to_agent (modified)

```
1. resolveSession(session_id)
2. sessionMonitor.getTask(sessionId)
   → No task: return error "Session has no active task"
   → Task status != waiting_input: return error "Agent is not waiting for input"
   → waiting_input: continue
3. adapter.sendResponse(bridge, paneTarget, value)
4. captureHash(paneTarget) → newPreHash
5. sessionMonitor.resumeTask(sessionId, newPreHash)
6. Return immediately:
   "Response sent, agent continuing execution."
```

### inspect_session (renamed from fetch_more)

```
1. resolveSession(session_id)
2. bridge.capturePane(paneTarget, { startLine: -lines })
3. sessionMonitor.getTask(sessionId) → optional status summary
4. Return:
   "[Session <id>] Status: <running|waiting_input|idle>
    <pane content>"
```

No restriction on when it can be called. Works during execution, while waiting, or after completion.

### Callback Message Format

```
[AGENT_CALLBACK session_id=<id> task_id=<id> status=<completed|error|waiting_input|timeout>]
Agent task settled with status: <status> (<detail>)

<pane content, last 100 lines>
```

## MainAgent Changes

### Code to Remove

From `send_to_agent` and `respond_to_agent` case branches:
- `stateDetector.waitForSettled()` calls
- `captureAnsiPaneContent()` and `buildPaneSnippet()`
- `collectWorkspaceEvidence()` and `extractTestEvidence()`
- `emitExecutionEvent({ phase: "settled" })`

These responsibilities move into SessionMonitor's callback logic.

### Code to Keep Unchanged

- Tool loop (`executeToolLoop`) — no changes
- State machine (IDLE ↔ EXECUTING) — no changes
- MessageQueue — no changes
- SignalRouter — retained but no longer used by agent tools (per-task abort replaces it)
- `emitExecutionEvent({ phase: "planned" })` — stays in tool call site

### Session Lifecycle Integration

```
create_session  → sessions.set()  (unchanged)
exit_agent      → sessionMonitor.cleanup(id) → sessions.delete(id)
kill_session    → sessionMonitor.cleanup(id) → sessions.delete(id)
shutdown        → sessionMonitor.shutdown()
```

### Execution Events

- `planned` phase: emitted synchronously at tool call site (unchanged)
- `settled` phase: SessionMonitor includes workspace/test evidence in callback; MainAgent can emit the event when processing the callback, or delegate to SessionMonitor via an optional `onExecutionEvent` callback. Preferred: keep SessionMonitor unaware of execution events; include evidence in callback message for LLM to act on.

## Prompt Updates

### Tool Descriptions

**send_to_agent**: "Send an instruction prompt to the coding agent. Returns immediately with a task_id. The agent executes asynchronously — you will receive a callback message when the agent finishes, encounters an error, or needs input. If the target session is busy, returns the current task info and recent agent logs instead."

**respond_to_agent**: "Respond to an agent waiting for input. Only callable when the session has an active task in waiting_input status. Returns immediately — you will receive a callback when the agent settles again. Formats: 'Enter', 'Escape', 'y', 'n', 'arrow:down:N', 'keys:K1,K2,...', or plain text."

**inspect_session**: "Inspect a session's current pane content and task status. Can be used at any time — during agent execution, while waiting, or after completion. Useful for checking progress, understanding what an agent is doing, or getting more context beyond what a callback provided."

### System Prompt Additions (prompts/main-agent.md)

Add a section on the async agent model:

1. `send_to_agent` / `respond_to_agent` are non-blocking — you return to conversation immediately after dispatching
2. Sub-agent state changes arrive as `[AGENT_CALLBACK ...]` messages
3. On callback, decide next action based on status: completed → report/continue, error → analyze/retry, waiting_input → use `respond_to_agent`
4. You can dispatch tasks to multiple sessions concurrently
5. Users may chat with you while agents are executing — respond normally

## Files Affected

| File | Change |
|------|--------|
| `src/core/session-monitor.ts` | **New** — SessionMonitor class |
| `src/core/main-agent.ts` | Modify — inject SessionMonitor, simplify tool cases, add cleanup calls |
| `prompts/main-agent.md` | Modify — add async model guidance, update tool descriptions |
| `test/core/session-monitor.test.ts` | **New** — unit tests for SessionMonitor |
| `test/core/main-agent.test.ts` | Modify — update tool tests for non-blocking behavior |
