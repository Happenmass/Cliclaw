# Async Agent Tools Design

## Problem

`send_to_agent` and `respond_to_agent` block the MainAgent's execution loop by synchronously awaiting `stateDetector.waitForSettled()`. During this time, MainAgent cannot respond to user messages — they are queued in MessageQueue and only processed between tool rounds. This makes the chat interface unresponsive whenever a sub-agent is working.

## Solution

Make `send_to_agent` and `respond_to_agent` non-blocking. Extract sub-agent lifecycle monitoring into a new `SessionMonitor` module. Sub-agent state changes (completion, error, waiting for input) are delivered back to MainAgent as callback messages via `handleMessage`, with dedicated handling to distinguish callbacks from human messages.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool loop changes | Keep tool loop unchanged | Only agent interaction tools need async; other tools (exec_command, memory) are fast and benefit from sync execution |
| State management granularity | Per-session | Each tmux session is a physically isolated agent process; one active task per session |
| Callback delivery | Via `handleMessage` with `[AGENT_CALLBACK]` prefix detection | Reuses existing entry point but with dedicated prefix handling to avoid confusion with `[HUMAN]` messages |
| Monitoring approach | Per-task background polling | Wraps existing `waitForSettled` in a fire-and-forget async loop; avoids global scheduler complexity |
| Module extraction | New `SessionMonitor` class | `main-agent.ts` is 1400+ lines; session monitoring is an orthogonal concern that benefits from separation |
| Callback content | Fixed 100 lines of pane content + original task summary | Simple, consistent, self-contained — LLM can use `inspect_session` for more |

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
├── Callback message construction (includes original task summary)
├── Notifies MainAgent via injected onCallback function
└── Optionally emits structured onSettled events for execution tracking

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
  onSettled: (event: SettledEvent) => {
    this.emitExecutionEvent({ ...event, phase: "settled" });
  },
});
```

SessionMonitor does not depend on MainAgent. It communicates outward through injected callback functions: `onCallback` for message injection, `onSettled` (optional) for structured execution events.

## Callback Message Handling

### Problem: Distinguishing Callbacks from Human Messages

When MainAgent is in EXECUTING state, incoming messages are queued in MessageQueue and later injected with `[HUMAN]` prefix. Callback messages must NOT be treated as human messages.

### Solution: Prefix-Based Detection in handleMessage

Callback messages are constructed with the `[AGENT_CALLBACK ...]` prefix by SessionMonitor. `handleMessage` detects this prefix and handles it differently from human messages:

- **IDLE state**: Callback triggers a new LLM call directly (same as a human message, but injected with `[AGENT_CALLBACK]` prefix instead of raw content)
- **EXECUTING state**: Callback is queued in MessageQueue. During `executeToolLoop`'s between-round drain, callback messages are identified by their prefix and injected as-is (preserving `[AGENT_CALLBACK]` prefix), NOT wrapped in `[HUMAN]`.

```typescript
// In executeToolLoop drain logic:
const queued = this.messageQueue.drain();
for (const msg of queued) {
  const isCallback = msg.startsWith("[AGENT_CALLBACK");
  this.contextManager.addMessage({
    role: "user",
    content: isCallback ? msg : `[HUMAN] ${msg}`,
  });
}
```

This ensures LLM always sees the correct message source: `[HUMAN]` for user messages, `[AGENT_CALLBACK ...]` for sub-agent notifications.

### Concurrent Callback Safety

Multiple sessions may complete near-simultaneously. The first callback to arrive when IDLE triggers `handleMessage` → EXECUTING. Subsequent callbacks are queued in MessageQueue and processed in the next between-round drain. This is safe — each callback is self-contained with its own session_id, task_id, summary, and pane content.

## SessionMonitor Internal Design

### Data Structures

```typescript
interface TaskInfo {
  taskId: string;              // Unique ID, e.g. "task_<nanoid>"
  sessionId: string;           // Owning session
  type: "prompt" | "response"; // Dispatch type
  status: "running" | "waiting_input"; // Task state (settled tasks are removed)
  summary: string;             // Original task summary from send_to_agent
  taskContext: string;         // Task context for StateDetector LLM analysis
  preHash: string;             // Pane content hash before dispatch
  startedAt: number;           // Timestamp
  abortController: AbortController; // Per-task abort (Node.js native)
}

type DispatchResult =
  | { dispatched: true; task: TaskInfo }
  | { dispatched: false; busy: BusyResult };

interface BusyResult {
  sessionId: string;
  currentTask: TaskInfo;
  paneContent: string;         // Latest 100 lines
}

interface SettledEvent {
  runId: string;
  toolName: string;
  summary: string;
  pane?: object;
  workspace?: object;
  test?: object;
  verification?: object;
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
    onSettled?: (event: SettledEvent) => void;
  });

  dispatch(sessionId: string, paneTarget: string, opts: {
    preHash: string;
    summary: string;
    taskContext?: string;
  }): DispatchResult;
  resumeTask(sessionId: string, newPreHash: string): boolean;
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
  → isBusy? → yes: return { dispatched: false, busy: BusyResult }
  → Create TaskInfo (with summary, taskContext), store in Map
  → Call signalRouter.notifyPromptSent(taskContext) for capture line expansion
  → Fire-and-forget async polling loop:
      → stateDetector.waitForSettled(paneTarget, taskContext, {
          preHash,
          isAborted: () => abortController.signal.aborted
        })
      → On settle:
          if waiting_input:
            → Update task status to "waiting_input"
            → Fire onCallback (status=waiting_input, include summary)
            → Pause polling (wait for resumeTask)
          if completed/error/timeout:
            → Capture 100 lines of pane content
            → Collect workspace evidence
            → Fire onCallback (status=completed/error/timeout, include summary)
            → Fire onSettled (structured event) if provided
            → Remove task from Map
      → On exception:
          → Fire onCallback with error info and summary
          → Remove task from Map
  → Return { dispatched: true, task: TaskInfo } immediately
```

### resumeTask Flow

Called by `respond_to_agent` after sending keys. Returns `true` on success, `false` if task not found or not in `waiting_input` state.

```
resumeTask(sessionId, newPreHash) → boolean
  → Get task from Map
  → If not found or status != waiting_input: return false
  → Update preHash to newPreHash
  → Set status back to "running"
  → Restart async polling loop with new preHash
  → Return true
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
  │  settled   │ → fire callbacks → remove from Map
  └────────────┘
  (completed / error / timeout)
```

### Shutdown Behavior

`shutdown()` aborts all active tasks via their AbortControllers. Each aborted polling loop fires a callback with `status=aborted` before exiting, so MainAgent is informed that tasks were forcefully terminated.

```
shutdown()
  → For each active task in Map:
      → task.abortController.abort()
      → (polling loop detects abort, fires callback with status=aborted, removes from Map)
  → Clear Map
```

## Tool Behavior Changes

### send_to_agent (modified)

```
1. resolveSession(session_id)
2. sessionMonitor.dispatch(sessionId, paneTarget, { preHash, summary, taskContext: prompt })
   → dispatched: false → return busy info + 100 lines of agent logs
   → dispatched: true → continue
3. adapter.sendPrompt(bridge, paneTarget, prompt)
4. Return immediately:
   "Task dispatched. task_id: <id>, session: <id>.
    You will receive a callback when the agent finishes."
```

Note: `captureHash` → `sendPrompt` → `dispatch` ordering ensures preHash is captured before prompt is sent, and dispatch registers monitoring before returning.

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
   → false: return error "Failed to resume task"
   → true: continue
6. Return immediately:
   "Response sent, agent continuing execution."
```

### inspect_session (renamed from fetch_more)

```
1. resolveSession(session_id)
2. bridge.capturePane(paneTarget, { startLine: -lines })
   → If session/pane not found: return friendly error
3. sessionMonitor.getTask(sessionId) → optional status summary
4. Return:
   "[Session <id>] Status: <running|waiting_input|idle>
    <pane content>"
```

No restriction on when it can be called. Works during execution, while waiting, or after completion. Handles destroyed sessions gracefully.

### Callback Message Format

```
[AGENT_CALLBACK session_id=<id> task_id=<id> status=<completed|error|waiting_input|timeout|aborted>]
Original task: <summary from send_to_agent>
Agent task settled with status: <status> (<detail>)

<pane content, last 100 lines>
```

Including the original task summary ensures LLM can correlate the callback with the dispatched task, even after multiple conversation turns.

## MainAgent Changes

### Code to Remove

From `send_to_agent` and `respond_to_agent` case branches:
- `stateDetector.waitForSettled()` calls
- `captureAnsiPaneContent()` and `buildPaneSnippet()`
- `collectWorkspaceEvidence()` and `extractTestEvidence()`
- `emitExecutionEvent({ phase: "settled" })` (moved to SessionMonitor's onSettled callback)

These responsibilities move into SessionMonitor's callback logic.

### Code to Migrate

- `signalRouter.notifyPromptSent()`: moves into `SessionMonitor.dispatch()` — called with taskContext to enable capture line expansion
- `collectWorkspaceEvidence()` and `extractTestEvidence()`: called by SessionMonitor before firing onSettled

### Code to Modify

- `handleMessage()`: no structural change, but the `enqueueMessageForExecutingState` path must preserve callback messages as-is
- `executeToolLoop()` between-round drain: detect `[AGENT_CALLBACK` prefix and inject without `[HUMAN]` wrapper
- `exit_agent` / `kill_session`: add `sessionMonitor.cleanup(id)` before `sessions.delete(id)`
- Shutdown handler: add `sessionMonitor.shutdown()`

### Code to Keep Unchanged

- Tool loop (`executeToolLoop`) — structure unchanged (only drain logic adds prefix detection)
- State machine (IDLE ↔ EXECUTING) — no changes
- MessageQueue — no changes
- SignalRouter — retained, `notifyPromptSent` still called (from SessionMonitor)
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
- `settled` phase: emitted by MainAgent via the `onSettled` callback injected into SessionMonitor. SessionMonitor collects workspace/test evidence and passes structured data to `onSettled`. This keeps SessionMonitor unaware of ExecutionEvent types while ensuring events are still emitted.

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
| `src/core/main-agent.ts` | Modify — inject SessionMonitor, simplify tool cases, add cleanup calls, modify drain logic |
| `src/core/signal-router.ts` | Minor — `notifyPromptSent` now called from SessionMonitor (verify public access) |
| `src/server/command-router.ts` | Modify — `/stop` command should abort all active tasks via `sessionMonitor.shutdown()` in addition to setting SignalRouter flag |
| `prompts/main-agent.md` | Modify — add async model guidance, update tool descriptions |
| `test/core/session-monitor.test.ts` | **New** — unit tests for SessionMonitor |
| `test/core/main-agent.test.ts` | Modify — update tool tests for non-blocking behavior |
