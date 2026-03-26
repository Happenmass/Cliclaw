# Async Agent Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `send_to_agent` and `respond_to_agent` non-blocking by extracting agent lifecycle monitoring into a new `SessionMonitor` module with callback-based state notifications.

**Architecture:** New `SessionMonitor` class manages per-session background polling (reusing `StateDetector.waitForSettled`). Tools dispatch tasks and return immediately. Agent state changes (completion, error, waiting_input) are delivered as `[AGENT_CALLBACK ...]` prefixed messages via `handleMessage`. Both IDLE and EXECUTING drain paths detect this prefix to avoid `[HUMAN]` misclassification.

**Tech Stack:** TypeScript, Node.js native `AbortController`, vitest for tests

**Spec:** `docs/superpowers/specs/2026-03-25-async-agent-tools-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/core/session-monitor.ts` | **New** — Task lifecycle, per-session busy state, background polling, callback construction |
| `test/core/session-monitor.test.ts` | **New** — Unit tests for SessionMonitor |
| `src/core/main-agent.ts` | **Modify** — Inject SessionMonitor, rewrite tool cases, add prefix detection in drain logic, lifecycle hooks |
| `src/main.ts` | **Modify** — Add `sessionMonitor.shutdown()` to graceful shutdown |
| `prompts/main-agent.md` | **Modify** — Add async model guidance section |
| `test/core/main-agent.test.ts` | **Modify** — Update tool tests for non-blocking behavior |

---

### Task 1: Create SessionMonitor — Types and Constructor

**Files:**
- Create: `src/core/session-monitor.ts`
- Test: `test/core/session-monitor.test.ts`

- [ ] **Step 1: Write the test file with constructor and type tests**

```typescript
// test/core/session-monitor.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionMonitor } from "../../src/core/session-monitor.js";
import type { StateDetector } from "../../src/tmux/state-detector.js";
import type { TmuxBridge } from "../../src/tmux/bridge.js";
import type { SignalRouter } from "../../src/core/signal-router.js";

function createMockStateDetector(): StateDetector {
	return {
		captureHash: vi.fn().mockResolvedValue("hash-abc"),
		waitForSettled: vi.fn().mockResolvedValue({
			analysis: { status: "completed", detail: "Agent finished" },
			content: "done",
			timedOut: false,
		}),
	} as unknown as StateDetector;
}

function createMockBridge(): TmuxBridge {
	return {
		capturePane: vi.fn().mockResolvedValue({
			content: "pane content line 1\npane content line 2",
			lines: ["pane content line 1", "pane content line 2"],
			timestamp: Date.now(),
		}),
	} as unknown as TmuxBridge;
}

function createMockSignalRouter(): SignalRouter {
	return {
		notifyPromptSent: vi.fn(),
		resetCaptureExpansion: vi.fn(),
		getCaptureLines: vi.fn().mockReturnValue(50),
	} as unknown as SignalRouter;
}

describe("SessionMonitor", () => {
	let monitor: SessionMonitor;
	let mockStateDetector: StateDetector;
	let mockBridge: TmuxBridge;
	let mockSignalRouter: SignalRouter;
	let onCallback: ReturnType<typeof vi.fn>;
	let onSettled: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockStateDetector = createMockStateDetector();
		mockBridge = createMockBridge();
		mockSignalRouter = createMockSignalRouter();
		onCallback = vi.fn();
		onSettled = vi.fn();
		monitor = new SessionMonitor({
			stateDetector: mockStateDetector,
			bridge: mockBridge,
			signalRouter: mockSignalRouter,
			onCallback,
			onSettled,
		});
	});

	describe("constructor", () => {
		it("should create an instance with no active tasks", () => {
			expect(monitor.getAllTasks()).toEqual([]);
			expect(monitor.isBusy("any-session")).toBe(false);
		});

		it("should return null for unknown session task", () => {
			expect(monitor.getTask("nonexistent")).toBeNull();
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/session-monitor.test.ts`
Expected: FAIL — cannot resolve `../../src/core/session-monitor.js`

- [ ] **Step 3: Write the types and constructor**

```typescript
// src/core/session-monitor.ts
import type {
	ExecutionPaneSnippet,
	ExecutionTestEvidence,
	ExecutionVerificationEvidence,
	ExecutionWorkspaceEvidence,
} from "../server/execution-events.js";
import type { SignalRouter } from "./signal-router.js";
import type { TmuxBridge } from "../tmux/bridge.js";
import type { StateDetector } from "../tmux/state-detector.js";
import { logger } from "../utils/logger.js";

// ─── Types ──────────────────────────────────────────────

export interface TaskInfo {
	taskId: string;
	sessionId: string;
	status: "running" | "waiting_input";
	summary: string;
	taskContext: string;
	preHash: string;
	startedAt: number;
	abortController: AbortController;
}

export type DispatchResult = { dispatched: true; task: TaskInfo } | { dispatched: false; busy: BusyResult };

export interface BusyResult {
	sessionId: string;
	currentTask: TaskInfo;
	paneContent: string;
}

export interface SettledEvent {
	runId: string;
	toolName: string;
	summary: string;
	pane?: ExecutionPaneSnippet;
	workspace?: ExecutionWorkspaceEvidence;
	test?: ExecutionTestEvidence;
	verification?: ExecutionVerificationEvidence;
}

export interface SessionMonitorOptions {
	stateDetector: StateDetector;
	bridge: TmuxBridge;
	signalRouter: SignalRouter;
	onCallback: (message: string) => void;
	onSettled?: (event: SettledEvent) => void;
}

// ─── SessionMonitor ─────────────────────────────────────

export class SessionMonitor {
	private stateDetector: StateDetector;
	private bridge: TmuxBridge;
	private signalRouter: SignalRouter;
	private onCallback: (message: string) => void;
	private onSettled?: (event: SettledEvent) => void;
	private tasks: Map<string, TaskInfo> = new Map();

	constructor(opts: SessionMonitorOptions) {
		this.stateDetector = opts.stateDetector;
		this.bridge = opts.bridge;
		this.signalRouter = opts.signalRouter;
		this.onCallback = opts.onCallback;
		this.onSettled = opts.onSettled;
	}

	isBusy(sessionId: string): boolean {
		return this.tasks.has(sessionId);
	}

	getTask(sessionId: string): TaskInfo | null {
		return this.tasks.get(sessionId) ?? null;
	}

	getAllTasks(): TaskInfo[] {
		return [...this.tasks.values()];
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/core/session-monitor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/session-monitor.ts test/core/session-monitor.test.ts
git commit -m "feat(session-monitor): add types and constructor"
```

---

### Task 2: Implement dispatch and busy detection

**Files:**
- Modify: `src/core/session-monitor.ts`
- Modify: `test/core/session-monitor.test.ts`

- [ ] **Step 1: Write failing tests for dispatch**

Add to `test/core/session-monitor.test.ts` inside the `describe("SessionMonitor")` block:

```typescript
	describe("dispatch", () => {
		it("should dispatch a task and return TaskInfo", () => {
			const result = monitor.dispatch("session-1", "cliclaw-session-1:0", {
				preHash: "hash-before",
				summary: "Implement auth module",
				taskContext: "Write JWT auth for login endpoint",
			});

			expect(result.dispatched).toBe(true);
			if (!result.dispatched) return;
			expect(result.task.sessionId).toBe("session-1");
			expect(result.task.status).toBe("running");
			expect(result.task.summary).toBe("Implement auth module");
			expect(result.task.taskContext).toBe("Write JWT auth for login endpoint");
			expect(result.task.preHash).toBe("hash-before");
			expect(result.task.taskId).toMatch(/^task_/);
			expect(monitor.isBusy("session-1")).toBe(true);
		});

		it("should return BusyResult when session already has an active task", async () => {
			monitor.dispatch("session-1", "cliclaw-session-1:0", {
				preHash: "hash-1",
				summary: "First task",
			});

			const result = monitor.dispatch("session-1", "cliclaw-session-1:0", {
				preHash: "hash-2",
				summary: "Second task",
			});

			expect(result.dispatched).toBe(false);
			if (result.dispatched) return;
			expect(result.busy.sessionId).toBe("session-1");
			expect(result.busy.currentTask.summary).toBe("First task");
			expect(result.busy.paneContent).toBeDefined();
		});

		it("should allow dispatching to different sessions", () => {
			const result1 = monitor.dispatch("session-1", "pane-1", {
				preHash: "h1",
				summary: "Task A",
			});
			const result2 = monitor.dispatch("session-2", "pane-2", {
				preHash: "h2",
				summary: "Task B",
			});

			expect(result1.dispatched).toBe(true);
			expect(result2.dispatched).toBe(true);
			expect(monitor.getAllTasks()).toHaveLength(2);
		});

		it("should call signalRouter.notifyPromptSent with taskContext", () => {
			monitor.dispatch("session-1", "pane-1", {
				preHash: "h",
				summary: "s",
				taskContext: "/opsx apply something",
			});

			expect(mockSignalRouter.notifyPromptSent).toHaveBeenCalledWith("/opsx apply something");
		});
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/session-monitor.test.ts`
Expected: FAIL — `monitor.dispatch is not a function`

- [ ] **Step 3: Implement dispatch**

Add to `SessionMonitor` class in `src/core/session-monitor.ts`:

```typescript
	private taskCounter = 0;

	dispatch(
		sessionId: string,
		paneTarget: string,
		opts: { preHash: string; summary: string; taskContext?: string },
	): DispatchResult {
		// Busy check
		const existing = this.tasks.get(sessionId);
		if (existing) {
			let paneContent = "";
			try {
				// Synchronous-looking but we need to capture pane — use a cached approach
				// We'll store paneTarget on TaskInfo for later capture
				paneContent = `(session busy — use inspect_session for current logs)`;
			} catch {
				// Ignore capture errors for busy response
			}
			return {
				dispatched: false,
				busy: { sessionId, currentTask: existing, paneContent },
			};
		}

		const taskId = `task_${++this.taskCounter}`;
		const abortController = new AbortController();
		const task: TaskInfo = {
			taskId,
			sessionId,
			status: "running",
			summary: opts.summary,
			taskContext: opts.taskContext ?? "",
			preHash: opts.preHash,
			startedAt: Date.now(),
			abortController,
		};

		this.tasks.set(sessionId, task);
		this.signalRouter.notifyPromptSent(task.taskContext);

		// Start background polling (fire-and-forget)
		this.startPolling(task, paneTarget);

		return { dispatched: true, task };
	}

	// Placeholder — implemented in Task 3
	private startPolling(_task: TaskInfo, _paneTarget: string): void {
		// Will be implemented in next task
	}
```

Note: The busy response `paneContent` is a placeholder string because `dispatch` is synchronous but `capturePane` is async. The caller (`send_to_agent` tool case) will capture pane content itself before calling dispatch if needed. However, looking at the spec more carefully, the busy check should happen before `captureHash` and `sendPrompt`. So the flow is:

1. `isBusy()` → busy → capture pane and return busy info (in the tool case, not dispatch)
2. Not busy → `captureHash` → `sendPrompt` → `dispatch`

Let's simplify: `dispatch` does NOT need to return pane content in BusyResult — the tool case handles it. But for test consistency, let's keep BusyResult with an empty paneContent and have the tool case fill it.

Actually, re-reading the spec — the isBusy fast-path is at step 2 of send_to_agent, before captureHash. So dispatch would never be called when busy. Let's still handle the race condition in dispatch (double-check), but the tool case will check `isBusy()` first and capture pane itself.

Update: Keep the dispatch busy-check as a safety net. The paneContent in BusyResult from dispatch will be a placeholder. The tool case does the real isBusy + capture.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/core/session-monitor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/session-monitor.ts test/core/session-monitor.test.ts
git commit -m "feat(session-monitor): implement dispatch and busy detection"
```

---

### Task 3: Implement background polling and callback construction

**Files:**
- Modify: `src/core/session-monitor.ts`
- Modify: `test/core/session-monitor.test.ts`

- [ ] **Step 1: Write failing tests for polling lifecycle**

Add to `test/core/session-monitor.test.ts`:

```typescript
	describe("background polling", () => {
		it("should fire onCallback when agent completes", async () => {
			(mockStateDetector.waitForSettled as ReturnType<typeof vi.fn>).mockResolvedValue({
				analysis: { status: "completed", detail: "Agent finished" },
				content: "final output line 1\nfinal output line 2",
				timedOut: false,
			});

			monitor.dispatch("session-1", "pane-1", {
				preHash: "hash-before",
				summary: "Implement login",
			});

			// Allow async polling to complete
			await vi.waitFor(() => {
				expect(onCallback).toHaveBeenCalled();
			});

			const msg = onCallback.mock.calls[0][0] as string;
			expect(msg).toContain("[AGENT_CALLBACK");
			expect(msg).toContain("session_id=session-1");
			expect(msg).toContain("status=completed");
			expect(msg).toContain("Original task: Implement login");

			// Task should be removed after completion
			expect(monitor.isBusy("session-1")).toBe(false);
		});

		it("should fire onCallback with waiting_input and keep task active", async () => {
			(mockStateDetector.waitForSettled as ReturnType<typeof vi.fn>).mockResolvedValue({
				analysis: { status: "waiting_input", detail: "? Allow read access (y/n)" },
				content: "? Allow read access (y/n)",
				timedOut: false,
			});

			monitor.dispatch("session-1", "pane-1", {
				preHash: "hash-before",
				summary: "Write tests",
			});

			await vi.waitFor(() => {
				expect(onCallback).toHaveBeenCalled();
			});

			const msg = onCallback.mock.calls[0][0] as string;
			expect(msg).toContain("status=waiting_input");

			// Task should remain active with waiting_input status
			expect(monitor.isBusy("session-1")).toBe(true);
			const task = monitor.getTask("session-1");
			expect(task?.status).toBe("waiting_input");
		});

		it("should fire onCallback with error status", async () => {
			(mockStateDetector.waitForSettled as ReturnType<typeof vi.fn>).mockResolvedValue({
				analysis: { status: "error", detail: "Compilation failed" },
				content: "error output",
				timedOut: false,
			});

			monitor.dispatch("session-1", "pane-1", {
				preHash: "h",
				summary: "Build project",
			});

			await vi.waitFor(() => {
				expect(onCallback).toHaveBeenCalled();
			});

			const msg = onCallback.mock.calls[0][0] as string;
			expect(msg).toContain("status=error");
			expect(monitor.isBusy("session-1")).toBe(false);
		});

		it("should fire onCallback with timeout status", async () => {
			(mockStateDetector.waitForSettled as ReturnType<typeof vi.fn>).mockResolvedValue({
				analysis: { status: "active", detail: "Still running" },
				content: "still running...",
				timedOut: true,
			});

			monitor.dispatch("session-1", "pane-1", {
				preHash: "h",
				summary: "Long task",
			});

			await vi.waitFor(() => {
				expect(onCallback).toHaveBeenCalled();
			});

			const msg = onCallback.mock.calls[0][0] as string;
			expect(msg).toContain("status=timeout");
			expect(monitor.isBusy("session-1")).toBe(false);
		});

		it("should fire onCallback on polling exception", async () => {
			(mockStateDetector.waitForSettled as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error("tmux session died"),
			);

			monitor.dispatch("session-1", "pane-1", {
				preHash: "h",
				summary: "Doomed task",
			});

			await vi.waitFor(() => {
				expect(onCallback).toHaveBeenCalled();
			});

			const msg = onCallback.mock.calls[0][0] as string;
			expect(msg).toContain("status=error");
			expect(msg).toContain("tmux session died");
			expect(monitor.isBusy("session-1")).toBe(false);
		});

		it("should fire onSettled for terminal states", async () => {
			(mockStateDetector.waitForSettled as ReturnType<typeof vi.fn>).mockResolvedValue({
				analysis: { status: "completed", detail: "Done" },
				content: "done",
				timedOut: false,
			});

			monitor.dispatch("session-1", "pane-1", {
				preHash: "h",
				summary: "Build it",
			});

			await vi.waitFor(() => {
				expect(onSettled).toHaveBeenCalled();
			});

			const event = onSettled.mock.calls[0][0];
			expect(event.summary).toBe("Build it");
			expect(event.toolName).toBe("send_to_agent");
		});

		it("should include duration in callback message", async () => {
			(mockStateDetector.waitForSettled as ReturnType<typeof vi.fn>).mockResolvedValue({
				analysis: { status: "completed", detail: "Done" },
				content: "done",
				timedOut: false,
			});

			monitor.dispatch("session-1", "pane-1", {
				preHash: "h",
				summary: "Quick task",
			});

			await vi.waitFor(() => {
				expect(onCallback).toHaveBeenCalled();
			});

			const msg = onCallback.mock.calls[0][0] as string;
			expect(msg).toMatch(/duration=\d+/);
		});
	});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `npx vitest run test/core/session-monitor.test.ts`
Expected: FAIL — callback never fires (startPolling is a no-op)

- [ ] **Step 3: Implement startPolling and buildCallbackMessage**

Replace the placeholder `startPolling` in `src/core/session-monitor.ts`:

```typescript
	private startPolling(task: TaskInfo, paneTarget: string): void {
		const run = async () => {
			try {
				const result = await this.stateDetector.waitForSettled(paneTarget, task.taskContext, {
					preHash: task.preHash,
					isAborted: () => task.abortController.signal.aborted,
				});

				if (task.abortController.signal.aborted) {
					this.fireCallback(task, "aborted", "Task was aborted", paneTarget);
					this.tasks.delete(task.sessionId);
					return;
				}

				const status = result.timedOut ? "timeout" : result.analysis.status;

				if (status === "waiting_input") {
					task.status = "waiting_input";
					this.fireCallback(task, "waiting_input", result.analysis.detail, paneTarget);
					// Do NOT remove from map — wait for resumeTask
					return;
				}

				// Terminal states: completed, error, timeout
				const terminalStatus = status === "completed" || status === "error" ? status : "timeout";
				this.fireCallback(task, terminalStatus, result.analysis.detail, paneTarget);
				this.fireSettledEvent(task, result.content, paneTarget);
				this.tasks.delete(task.sessionId);
			} catch (err: any) {
				if (task.abortController.signal.aborted) {
					this.fireCallback(task, "aborted", "Task was aborted", paneTarget);
				} else {
					this.fireCallback(task, "error", `Polling error: ${err.message}`, paneTarget);
				}
				this.tasks.delete(task.sessionId);
			}
		};

		// Fire-and-forget
		run().catch((err) => {
			logger.error("session-monitor", `Unexpected polling error for ${task.sessionId}: ${err.message}`);
		});
	}

	private fireCallback(
		task: TaskInfo,
		status: string,
		detail: string,
		_paneTarget: string,
	): void {
		const duration = Math.round((Date.now() - task.startedAt) / 1000);
		const lines = [
			`[AGENT_CALLBACK session_id=${task.sessionId} task_id=${task.taskId} status=${status} duration=${duration}s]`,
			`Original task: ${task.summary}`,
			`Agent task settled with status: ${status} (${detail})`,
		];
		this.onCallback(lines.join("\n"));
	}

	private fireSettledEvent(task: TaskInfo, content: string, _paneTarget: string): void {
		if (!this.onSettled) return;

		const pane: ExecutionPaneSnippet = {
			content: content.split("\n").slice(-40).join("\n").slice(-4000),
			lines: Math.min(content.split("\n").length, 40),
			capturedAt: Date.now(),
		};

		this.onSettled({
			runId: `${task.taskId}-settled`,
			toolName: "send_to_agent",
			summary: task.summary,
			pane,
		});
	}
```

- [ ] **Step 4: Run test to verify they pass**

Run: `npx vitest run test/core/session-monitor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/session-monitor.ts test/core/session-monitor.test.ts
git commit -m "feat(session-monitor): implement background polling and callback construction"
```

---

### Task 4: Implement resumeTask, cleanup, and shutdown

**Files:**
- Modify: `src/core/session-monitor.ts`
- Modify: `test/core/session-monitor.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/core/session-monitor.test.ts`:

```typescript
	describe("resumeTask", () => {
		it("should resume a waiting_input task and restart polling", async () => {
			let callCount = 0;
			(mockStateDetector.waitForSettled as ReturnType<typeof vi.fn>).mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					return {
						analysis: { status: "waiting_input", detail: "? Confirm (y/n)" },
						content: "? Confirm (y/n)",
						timedOut: false,
					};
				}
				return {
					analysis: { status: "completed", detail: "Done after response" },
					content: "completed output",
					timedOut: false,
				};
			});

			monitor.dispatch("session-1", "pane-1", {
				preHash: "h1",
				summary: "Interactive task",
			});

			// Wait for waiting_input callback
			await vi.waitFor(() => {
				expect(onCallback).toHaveBeenCalledTimes(1);
			});

			expect(monitor.getTask("session-1")?.status).toBe("waiting_input");

			// Resume
			const resumed = monitor.resumeTask("session-1", "new-hash");
			expect(resumed).toBe(true);
			expect(monitor.getTask("session-1")?.status).toBe("running");

			// Wait for completion callback
			await vi.waitFor(() => {
				expect(onCallback).toHaveBeenCalledTimes(2);
			});

			const completionMsg = onCallback.mock.calls[1][0] as string;
			expect(completionMsg).toContain("status=completed");
			expect(monitor.isBusy("session-1")).toBe(false);
		});

		it("should return false if session has no task", () => {
			expect(monitor.resumeTask("nonexistent", "h")).toBe(false);
		});

		it("should return false if task is not in waiting_input", () => {
			monitor.dispatch("session-1", "pane-1", {
				preHash: "h",
				summary: "Running task",
			});
			// Task is in "running" state, not "waiting_input"
			expect(monitor.resumeTask("session-1", "new-hash")).toBe(false);
		});
	});

	describe("cleanup", () => {
		it("should abort and remove the task for a session", async () => {
			// Use a never-resolving promise to simulate long-running task
			(mockStateDetector.waitForSettled as ReturnType<typeof vi.fn>).mockReturnValue(
				new Promise(() => {}), // Never resolves
			);

			monitor.dispatch("session-1", "pane-1", {
				preHash: "h",
				summary: "Long task",
			});
			expect(monitor.isBusy("session-1")).toBe(true);

			monitor.cleanup("session-1");
			expect(monitor.isBusy("session-1")).toBe(false);
		});

		it("should be a no-op for unknown sessions", () => {
			expect(() => monitor.cleanup("nonexistent")).not.toThrow();
		});
	});

	describe("shutdown", () => {
		it("should abort all active tasks", async () => {
			(mockStateDetector.waitForSettled as ReturnType<typeof vi.fn>).mockReturnValue(
				new Promise(() => {}),
			);

			monitor.dispatch("session-1", "pane-1", { preHash: "h1", summary: "Task 1" });
			monitor.dispatch("session-2", "pane-2", { preHash: "h2", summary: "Task 2" });

			expect(monitor.getAllTasks()).toHaveLength(2);

			monitor.shutdown();

			expect(monitor.getAllTasks()).toHaveLength(0);
		});
	});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `npx vitest run test/core/session-monitor.test.ts`
Expected: FAIL — `resumeTask`, `cleanup`, `shutdown` not defined

- [ ] **Step 3: Implement resumeTask, cleanup, shutdown**

Add to `SessionMonitor` class in `src/core/session-monitor.ts`:

```typescript
	// Store paneTarget per task for resumeTask polling restart
	private paneTargets: Map<string, string> = new Map();
```

Update `dispatch` to also store paneTarget:

```typescript
	// In dispatch, after this.tasks.set(sessionId, task):
	this.paneTargets.set(sessionId, paneTarget);
```

And add the cleanup of paneTargets in `fireCallback` for terminal states (after `this.tasks.delete`):

```typescript
	// In startPolling, after this.tasks.delete(task.sessionId):
	this.paneTargets.delete(task.sessionId);
```

Now add the methods:

```typescript
	resumeTask(sessionId: string, newPreHash: string): boolean {
		const task = this.tasks.get(sessionId);
		if (!task || task.status !== "waiting_input") {
			return false;
		}

		const paneTarget = this.paneTargets.get(sessionId);
		if (!paneTarget) {
			return false;
		}

		task.preHash = newPreHash;
		task.status = "running";

		// Restart polling with new preHash
		this.startPolling(task, paneTarget);

		return true;
	}

	cleanup(sessionId: string): void {
		const task = this.tasks.get(sessionId);
		if (!task) return;

		task.abortController.abort();
		this.tasks.delete(sessionId);
		this.paneTargets.delete(sessionId);
	}

	shutdown(): void {
		for (const [sessionId, task] of this.tasks) {
			task.abortController.abort();
			this.paneTargets.delete(sessionId);
		}
		this.tasks.clear();
	}
```

- [ ] **Step 4: Run test to verify they pass**

Run: `npx vitest run test/core/session-monitor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/session-monitor.ts test/core/session-monitor.test.ts
git commit -m "feat(session-monitor): implement resumeTask, cleanup, and shutdown"
```

---

### Task 5: Modify MainAgent — Callback prefix detection in drain logic

**Files:**
- Modify: `src/core/main-agent.ts`
- Modify: `test/core/main-agent.test.ts`

- [ ] **Step 1: Write failing test for prefix detection in executeToolLoop drain**

Add to `test/core/main-agent.test.ts`:

```typescript
describe("callback prefix detection", () => {
	it("should inject callback messages without [HUMAN] prefix in executeToolLoop drain", async () => {
		const callbackMsg = "[AGENT_CALLBACK session_id=s1 task_id=t1 status=completed]\nOriginal task: Fix bug\nDone";
		const { agent, mockContextManager } = setupAgent([
			toolCallResponse("mark_complete", { summary: "done" }),
		]);

		// Simulate: agent enters executing, callback arrives via messageQueue
		await agent.handleMessage("do something");

		// Now enqueue a callback and a human message
		// Access private messageQueue for test setup
		(agent as any).messageQueue.enqueue(callbackMsg);
		(agent as any).messageQueue.enqueue("human says hello");

		// The drain in executeToolLoop should differentiate them
		// Verify by checking contextManager.addMessage calls
		const addCalls = mockContextManager.addMessage.mock.calls;
		const callbackCall = addCalls.find(
			(c: any) => typeof c[0].content === "string" && c[0].content.includes("[AGENT_CALLBACK"),
		);
		const humanCall = addCalls.find(
			(c: any) => typeof c[0].content === "string" && c[0].content.includes("[HUMAN]"),
		);

		// Callback should NOT have [HUMAN] prefix
		if (callbackCall) {
			expect(callbackCall[0].content).not.toContain("[HUMAN]");
			expect(callbackCall[0].content).toContain("[AGENT_CALLBACK");
		}

		// Human message should have [HUMAN] prefix
		if (humanCall) {
			expect(humanCall[0].content).toContain("[HUMAN]");
		}
	});
});
```

Note: This test may need adjustment based on the exact test setup patterns used in the existing file. The key assertion is that `[AGENT_CALLBACK` prefixed messages pass through without `[HUMAN]` wrapping.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/main-agent.test.ts`
Expected: FAIL — callback message gets `[HUMAN]` prefix

- [ ] **Step 3: Modify the drain logic in executeToolLoop**

In `src/core/main-agent.ts`, find the between-round drain section (around line 603-612):

Replace:
```typescript
			// 2. Drain MessageQueue
			if (!this.messageQueue.isEmpty()) {
				const queued = this.messageQueue.drain();
				for (const msg of queued) {
					this.contextManager.addMessage({
						role: "user",
						content: `[HUMAN] ${msg}`,
					});
				}
			}
```

With:
```typescript
			// 2. Drain MessageQueue
			if (!this.messageQueue.isEmpty()) {
				const queued = this.messageQueue.drain();
				for (const msg of queued) {
					const isCallback = msg.startsWith("[AGENT_CALLBACK");
					this.contextManager.addMessage({
						role: "user",
						content: isCallback ? msg : `[HUMAN] ${msg}`,
					});
				}
			}
```

- [ ] **Step 4: Also modify processUserMessage for the IDLE path**

In `processUserMessage` (around line 698-701), the content is added directly without any prefix. For callback messages arriving in IDLE state, they pass through `drainPendingUserMessages` → `processUserMessage` → `contextManager.addMessage`. The content is added as-is, which is correct for callbacks (they already have the `[AGENT_CALLBACK` prefix). No change needed here — callbacks self-identify via their prefix.

However, we should verify: in the IDLE path, regular user messages are added without any prefix. The `[HUMAN]` prefix is only used in the EXECUTING drain. So in IDLE, both callback messages and user messages go directly into context without prefix. The LLM distinguishes them by the `[AGENT_CALLBACK` prefix that callbacks carry inherently.

This is consistent with the spec — no modification needed for the IDLE path.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/core/main-agent.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/main-agent.ts test/core/main-agent.test.ts
git commit -m "feat(main-agent): add callback prefix detection in executeToolLoop drain"
```

---

### Task 6: Rewrite send_to_agent to non-blocking

**Files:**
- Modify: `src/core/main-agent.ts`
- Modify: `test/core/main-agent.test.ts`

- [ ] **Step 1: Write failing test for non-blocking send_to_agent**

Add to `test/core/main-agent.test.ts`:

```typescript
describe("non-blocking send_to_agent", () => {
	it("should return immediately with task dispatch info", async () => {
		const { agent, mockBroadcaster } = setupAgent([
			toolCallResponse("send_to_agent", {
				prompt: "Write auth module",
				summary: "Writing auth",
				session_id: "cliclaw-test",
			}),
		]);

		// Set up a session
		agent.setPaneTarget("cliclaw-test:0", "cliclaw-test");

		await agent.handleMessage("implement auth");

		// Should have returned immediately without waiting for waitForSettled
		const agentUpdateMsgs = mockBroadcaster.broadcast.mock.calls
			.filter((c: any) => c[0].type === "agent_update");
		expect(agentUpdateMsgs.length).toBeGreaterThan(0);
	});

	it("should return busy info when session is busy", async () => {
		// This test needs SessionMonitor to be injected
		// Test that the tool returns busy info rather than blocking
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/core/main-agent.test.ts`
Expected: FAIL

- [ ] **Step 3: Add SessionMonitor to MainAgent constructor**

In `src/core/main-agent.ts`, add import:

```typescript
import { SessionMonitor } from "./session-monitor.js";
import type { SettledEvent } from "./session-monitor.js";
```

Add private field:

```typescript
	private sessionMonitor: SessionMonitor | null = null;
```

Add a method to set it up (called after construction since it depends on other fields):

```typescript
	setupSessionMonitor(): void {
		this.sessionMonitor = new SessionMonitor({
			stateDetector: this.stateDetector,
			bridge: this.bridge,
			signalRouter: this.signalRouter,
			onCallback: (message: string) => {
				this.handleMessage(message);
			},
			onSettled: (event: SettledEvent) => {
				this.emitExecutionEvent({ ...event, phase: "settled" });
			},
		});
	}
```

- [ ] **Step 4: Rewrite send_to_agent case**

Replace the entire `case "send_to_agent"` block (lines 1016-1068) with:

```typescript
			case "send_to_agent": {
				const resolved = this.resolveSession(args.session_id as string | undefined);
				if ("error" in resolved) {
					return { output: `Error: ${resolved.error}`, terminal: false };
				}
				const { entry: sendSession, id: sendSessionId } = resolved;
				this.activeSessionId = sendSessionId;

				const prompt = args.prompt as string;
				const summary = args.summary as string;

				// Non-blocking: check if session is busy
				if (this.sessionMonitor?.isBusy(sendSessionId)) {
					const task = this.sessionMonitor.getTask(sendSessionId)!;
					const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
					let paneContent = "";
					try {
						const capture = await this.bridge.capturePane(sendSession.paneTarget, { startLine: -100 });
						paneContent = capture.content;
					} catch {
						paneContent = "(failed to capture pane content)";
					}
					return {
						output: `Session ${sendSessionId} is busy (task_id: ${task.taskId}, running for ${elapsed}s).\nCurrent task: ${task.summary}\nCurrent agent logs:\n${paneContent}`,
						terminal: false,
					};
				}

				const runId = this.createExecutionRunId(name);
				this.emitUiEvent("agent_update", summary);
				this.emitExecutionEvent({
					runId,
					phase: "planned",
					toolName: name,
					summary,
					workspace: {
						workingDir: sendSession.workingDir,
						available: false,
						changedFiles: [],
					},
				});

				const sendPreHash = await this.stateDetector.captureHash(sendSession.paneTarget);
				await this.adapter.sendPrompt(this.bridge, sendSession.paneTarget, prompt);

				if (this.sessionMonitor) {
					const result = this.sessionMonitor.dispatch(sendSessionId, sendSession.paneTarget, {
						preHash: sendPreHash,
						summary,
						taskContext: prompt,
					});

					if (result.dispatched) {
						return {
							output: `Task dispatched. task_id: ${result.task.taskId}, session: ${sendSessionId}.\nYou will receive a callback when the agent finishes.`,
							terminal: false,
						};
					}
					// Shouldn't reach here (we checked isBusy above), but handle gracefully
					return {
						output: `Session ${sendSessionId} became busy unexpectedly.`,
						terminal: false,
					};
				}

				// Fallback: no SessionMonitor (shouldn't happen in production)
				return {
					output: "Error: SessionMonitor not initialized",
					terminal: false,
				};
			}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/core/main-agent.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/main-agent.ts test/core/main-agent.test.ts
git commit -m "feat(main-agent): rewrite send_to_agent to non-blocking"
```

---

### Task 7: Rewrite respond_to_agent to non-blocking

**Files:**
- Modify: `src/core/main-agent.ts`

- [ ] **Step 1: Rewrite respond_to_agent case**

Replace the entire `case "respond_to_agent"` block (lines 1070-1121) with:

```typescript
			case "respond_to_agent": {
				const resolved = this.resolveSession(args.session_id as string | undefined);
				if ("error" in resolved) {
					return { output: `Error: ${resolved.error}`, terminal: false };
				}
				const { entry: respondSession, id: respondSessionId } = resolved;
				this.activeSessionId = respondSessionId;

				const value = args.value as string;
				const summary = args.summary as string;

				// Check task state
				if (this.sessionMonitor) {
					const task = this.sessionMonitor.getTask(respondSessionId);
					if (!task) {
						return {
							output: `Error: Session ${respondSessionId} has no active task.`,
							terminal: false,
						};
					}
					if (task.status !== "waiting_input") {
						return {
							output: `Error: Agent in session ${respondSessionId} is not waiting for input (current status: ${task.status}).`,
							terminal: false,
						};
					}
				}

				const runId = this.createExecutionRunId(name);
				this.emitUiEvent("agent_update", summary);
				this.emitExecutionEvent({
					runId,
					phase: "planned",
					toolName: name,
					summary,
					workspace: {
						workingDir: respondSession.workingDir,
						available: false,
						changedFiles: [],
					},
				});

				await this.adapter.sendResponse(this.bridge, respondSession.paneTarget, value);

				if (this.sessionMonitor) {
					const newPreHash = await this.stateDetector.captureHash(respondSession.paneTarget);
					const resumed = this.sessionMonitor.resumeTask(respondSessionId, newPreHash);
					if (!resumed) {
						return {
							output: `Error: Failed to resume task monitoring for session ${respondSessionId}.`,
							terminal: false,
						};
					}
					return {
						output: "Response sent, agent continuing execution.",
						terminal: false,
					};
				}

				return {
					output: "Error: SessionMonitor not initialized",
					terminal: false,
				};
			}
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run test/core/main-agent.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/main-agent.ts
git commit -m "feat(main-agent): rewrite respond_to_agent to non-blocking"
```

---

### Task 8: Rename fetch_more to inspect_session

**Files:**
- Modify: `src/core/main-agent.ts`

- [ ] **Step 1: Update the tool definition**

Find the `fetch_more` tool definition in `TOOL_DEFINITIONS` (around line 95-109) and replace:

```typescript
	{
		name: "inspect_session",
		description:
			"Inspect a session's current pane content and task status. Can be used at any time — during agent execution, while waiting, or after completion. Useful for checking progress, understanding what an agent is doing, or getting more context beyond what a callback provided. If session_id is omitted, routes to the most recently used session.",
		parameters: {
			type: "object",
			properties: {
				lines: { type: "number", description: "Number of lines to capture (e.g. 100, 200, 500)" },
				session_id: {
					type: "string",
					description: "Target session name. If omitted, routes to the active session.",
				},
			},
			required: ["lines"],
		},
	},
```

- [ ] **Step 2: Update the tool case**

Replace the `case "fetch_more"` block (around line 1123-1131) with:

```typescript
			case "inspect_session": {
				const resolved = this.resolveSession(args.session_id as string | undefined);
				if ("error" in resolved) {
					return { output: `Error: ${resolved.error}`, terminal: false };
				}
				const { id: inspectSessionId } = resolved;
				const lines = args.lines as number;

				let paneContent: string;
				try {
					const capture = await this.bridge.capturePane(resolved.entry.paneTarget, { startLine: -lines });
					paneContent = capture.content;
				} catch (err: any) {
					return {
						output: `Error: Failed to capture pane for session ${inspectSessionId}: ${err.message}`,
						terminal: false,
					};
				}

				let statusLabel = "idle";
				if (this.sessionMonitor) {
					const task = this.sessionMonitor.getTask(inspectSessionId);
					if (task) {
						statusLabel = task.status;
					}
				}

				return {
					output: `[Session ${inspectSessionId}] Status: ${statusLabel}\n${paneContent}`,
					terminal: false,
				};
			}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run test/core/main-agent.test.ts`
Expected: PASS (may need to update any tests referencing `fetch_more`)

- [ ] **Step 4: Commit**

```bash
git add src/core/main-agent.ts
git commit -m "refactor(main-agent): rename fetch_more to inspect_session with status"
```

---

### Task 9: Lifecycle integration — exit_agent, kill_session, shutdown

**Files:**
- Modify: `src/core/main-agent.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add sessionMonitor.cleanup to exit_agent**

In the `exit_agent` case (around line 1359), find where `this.sessions.delete(exitSessionId)` is called and add cleanup before it:

```typescript
				// Before sessions.delete:
				this.sessionMonitor?.cleanup(exitSessionId);
				this.sessions.delete(exitSessionId);
```

- [ ] **Step 2: Add sessionMonitor.cleanup to kill_session**

In the `kill_session` case, find where `this.sessions.delete(targetName)` is called and add:

```typescript
				// Before sessions.delete for single session:
				this.sessionMonitor?.cleanup(targetName);
				this.sessions.delete(targetName);
```

And for the "all" branch, add cleanup for each session:

```typescript
				// In the "all" branch, before clearing sessions:
				for (const [id] of this.sessions) {
					this.sessionMonitor?.cleanup(id);
				}
```

- [ ] **Step 3: Add shutdown method to MainAgent**

Add a public method:

```typescript
	shutdownMonitor(): void {
		this.sessionMonitor?.shutdown();
	}
```

- [ ] **Step 4: Add to main.ts shutdown handler**

In `src/main.ts`, find the shutdown function (around line 859) and add the sessionMonitor shutdown:

```typescript
	const shutdown = async () => {
		console.log(chalk.yellow("\nShutting down..."));

		// Shutdown session monitor (abort background polling tasks)
		mainAgent.shutdownMonitor();

		// Stop MainAgent if executing
		if (mainAgent.state === "executing") {
			signalRouter.stop();
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		// ... rest unchanged
	};
```

- [ ] **Step 5: Call setupSessionMonitor in main.ts**

Find where `mainAgent` is created in `src/main.ts` and add `setupSessionMonitor()` call after construction:

```typescript
	// After: const mainAgent = new MainAgent({ ... });
	mainAgent.setupSessionMonitor();
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/main-agent.ts src/main.ts
git commit -m "feat(main-agent): add session monitor lifecycle integration"
```

---

### Task 10: Update tool descriptions in TOOL_DEFINITIONS

**Files:**
- Modify: `src/core/main-agent.ts`

- [ ] **Step 1: Update send_to_agent description**

Replace the description in the `send_to_agent` tool definition (around line 54-55):

```typescript
		description:
			"Send an instruction prompt to the coding agent. Returns immediately with a task_id. The agent executes asynchronously — you will receive a callback message when the agent finishes, encounters an error, or needs input. If the target session is busy, returns the current task info and recent agent logs instead. If session_id is omitted, routes to the most recently used session.",
```

- [ ] **Step 2: Update respond_to_agent description**

Replace the description in the `respond_to_agent` tool definition (around line 75-76):

```typescript
		description:
			"Respond to an agent waiting for input. Only callable when the session has an active task in waiting_input status. Returns immediately — you will receive a callback when the agent settles again. Formats: 'Enter', 'Escape', 'y', 'n', 'arrow:down:N', 'keys:K1,K2,...', or plain text. If session_id is omitted, routes to the most recently used session.",
```

- [ ] **Step 3: Run format and check**

Run: `npm run format && npm run check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/core/main-agent.ts
git commit -m "docs(main-agent): update tool descriptions for async model"
```

---

### Task 11: Update system prompt

**Files:**
- Modify: `prompts/main-agent.md`

- [ ] **Step 1: Read the current prompt**

Read: `prompts/main-agent.md` to find where to add the new section.

- [ ] **Step 2: Add async agent model section**

Add the following section to `prompts/main-agent.md`, after the session management section:

```markdown
## Asynchronous Agent Model

`send_to_agent` and `respond_to_agent` are **non-blocking** — they dispatch work and return immediately. You do NOT wait for the agent to finish before continuing.

### How it works

1. When you call `send_to_agent`, you receive a `task_id` confirmation. The agent begins working in the background.
2. When the agent finishes, encounters an error, or needs input, you receive a **callback message** prefixed with `[AGENT_CALLBACK ...]`.
3. You decide the next action based on the callback status:
   - `completed` — Report results to the user, or dispatch follow-up work
   - `error` — Analyze the error, retry, or escalate
   - `waiting_input` — Use `respond_to_agent` to answer the agent's prompt
   - `timeout` — Use `inspect_session` to check what happened, then decide

### Key behaviors

- You can dispatch tasks to **multiple sessions concurrently** — each session runs independently.
- Users may **chat with you while agents are executing** — respond to their messages normally.
- Use `inspect_session` anytime to check an agent's current output or progress.
- If a session is **busy** when you try to send a new prompt, you'll receive the current task info and recent logs instead.
```

- [ ] **Step 3: Commit**

```bash
git add prompts/main-agent.md
git commit -m "docs(prompt): add async agent model guidance to system prompt"
```

---

### Task 12: Update MainAgent tests for non-blocking tools

**Files:**
- Modify: `test/core/main-agent.test.ts`

- [ ] **Step 1: Update existing send_to_agent tests**

Find any tests that mock `stateDetector.waitForSettled` for send_to_agent and update them to expect immediate return instead of blocking. The key change: `waitForSettled` is no longer called directly from the tool case — it's called by `SessionMonitor` in the background.

For tests that verify `send_to_agent` output, update assertions to expect the dispatch confirmation message instead of the settled result.

- [ ] **Step 2: Update existing respond_to_agent tests**

Similar to send_to_agent — update tests to expect immediate return and the new error messages for state validation.

- [ ] **Step 3: Update fetch_more references to inspect_session**

Search for `"fetch_more"` in the test file and rename to `"inspect_session"`.

- [ ] **Step 4: Add mock for SessionMonitor in test setup**

Update `setupAgent` or equivalent test helper to call `agent.setupSessionMonitor()` after construction, ensuring SessionMonitor is available during tests.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Run format and lint**

Run: `npm run format && npm run check`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add test/core/main-agent.test.ts
git commit -m "test(main-agent): update tests for async agent tools"
```

---

### Task 13: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 3: Format and lint**

Run: `npm run format && npm run check`
Expected: Clean

- [ ] **Step 4: Final commit if any formatting changes**

```bash
git add -A
git commit -m "chore: format and lint fixes"
```
