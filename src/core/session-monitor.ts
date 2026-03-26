import type {
	ExecutionPaneSnippet,
	ExecutionTestEvidence,
	ExecutionVerificationEvidence,
	ExecutionWorkspaceEvidence,
} from "../server/execution-events.js";
import type { TmuxBridge } from "../tmux/bridge.js";
import type { StateDetector } from "../tmux/state-detector.js";
import { logger } from "../utils/logger.js";
import type { SignalRouter } from "./signal-router.js";

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

interface SessionMonitorOptions {
	stateDetector: StateDetector;
	bridge: TmuxBridge;
	signalRouter: SignalRouter;
	onCallback: (message: string) => void;
	onSettled?: (event: SettledEvent) => void;
}

export class SessionMonitor {
	private stateDetector: StateDetector;
	private bridge: TmuxBridge;
	private signalRouter: SignalRouter;
	private onCallback: (message: string) => void;
	private onSettled?: (event: SettledEvent) => void;

	private tasks = new Map<string, TaskInfo>();
	private paneTargets = new Map<string, string>();
	private taskCounter = 0;

	constructor(opts: SessionMonitorOptions) {
		this.stateDetector = opts.stateDetector;
		this.bridge = opts.bridge;
		this.signalRouter = opts.signalRouter;
		this.onCallback = opts.onCallback;
		this.onSettled = opts.onSettled;
	}

	dispatch(
		sessionId: string,
		paneTarget: string,
		opts: { preHash: string; summary: string; taskContext?: string },
	): DispatchResult {
		const existing = this.tasks.get(sessionId);
		if (existing) {
			return {
				dispatched: false,
				busy: {
					sessionId,
					currentTask: existing,
					paneContent: "(session busy)",
				},
			};
		}

		this.taskCounter++;
		const taskId = `task_${this.taskCounter}`;
		const taskContext = opts.taskContext ?? opts.summary;

		const task: TaskInfo = {
			taskId,
			sessionId,
			status: "running",
			summary: opts.summary,
			taskContext,
			preHash: opts.preHash,
			startedAt: Date.now(),
			abortController: new AbortController(),
		};

		this.tasks.set(sessionId, task);
		this.paneTargets.set(sessionId, paneTarget);

		this.signalRouter.notifyPromptSent(taskContext);

		// Fire-and-forget background polling
		this.startPolling(sessionId, paneTarget, task);

		return { dispatched: true, task };
	}

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

		// Restart polling
		this.startPolling(sessionId, paneTarget, task);

		return true;
	}

	isBusy(sessionId: string): boolean {
		return this.tasks.has(sessionId);
	}

	getTask(sessionId: string): TaskInfo | null {
		return this.tasks.get(sessionId) ?? null;
	}

	getAllTasks(): TaskInfo[] {
		return Array.from(this.tasks.values());
	}

	cleanup(sessionId: string): void {
		const task = this.tasks.get(sessionId);
		if (task) {
			task.abortController.abort();
			this.tasks.delete(sessionId);
			this.paneTargets.delete(sessionId);
		}
	}

	shutdown(): void {
		for (const [_sessionId, task] of this.tasks) {
			task.abortController.abort();
		}
		this.tasks.clear();
		this.paneTargets.clear();
	}

	private startPolling(sessionId: string, paneTarget: string, task: TaskInfo): void {
		const poll = async () => {
			try {
				const result = await this.stateDetector.waitForSettled(paneTarget, task.taskContext, {
					preHash: task.preHash,
					isAborted: () => task.abortController.signal.aborted,
				});

				// Check if aborted
				if (task.abortController.signal.aborted) {
					const duration = Math.round((Date.now() - task.startedAt) / 1000);
					this.fireCallback(task, "aborted", "Task was aborted", duration);
					this.tasks.delete(sessionId);
					this.paneTargets.delete(sessionId);
					return;
				}

				const status = result.analysis.status;
				const duration = Math.round((Date.now() - task.startedAt) / 1000);

				if (status === "waiting_input") {
					task.status = "waiting_input";
					this.fireCallback(task, "waiting_input", result.analysis.detail, duration);
					// Do NOT delete from Map — wait for resumeTask
					return;
				}

				if (result.timedOut) {
					this.fireCallback(task, "timeout", result.analysis.detail, duration);
					this.fireSettledEvent(task, result.content);
					this.tasks.delete(sessionId);
					this.paneTargets.delete(sessionId);
					return;
				}

				// Terminal states: completed, error, or anything else
				this.fireCallback(task, status, result.analysis.detail, duration);
				this.fireSettledEvent(task, result.content);
				this.tasks.delete(sessionId);
				this.paneTargets.delete(sessionId);
			} catch (err: any) {
				const duration = Math.round((Date.now() - task.startedAt) / 1000);
				this.fireCallback(task, "error", `Exception: ${err.message}`, duration);
				this.tasks.delete(sessionId);
				this.paneTargets.delete(sessionId);
			}
		};

		// Fire-and-forget
		poll().catch((err) => {
			logger.error("session-monitor", `Unexpected polling error for ${sessionId}: ${err.message}`);
		});
	}

	private fireCallback(task: TaskInfo, status: string, detail: string, durationSeconds: number): void {
		const message = [
			`[AGENT_CALLBACK session_id=${task.sessionId} task_id=${task.taskId} status=${status} duration=${durationSeconds}s]`,
			`Original task: ${task.summary}`,
			`Agent task settled with status: ${status} (${detail})`,
		].join("\n");

		logger.info("session-monitor", `Task ${task.taskId} settled: ${status} (${durationSeconds}s)`);
		this.onCallback(message);
	}

	private fireSettledEvent(task: TaskInfo, content: string): void {
		if (!this.onSettled) return;

		const lines = content.split("\n");
		const lastLines = lines.slice(-40);
		let snippet = lastLines.join("\n");
		if (snippet.length > 4000) {
			snippet = snippet.slice(-4000);
		}

		const pane: ExecutionPaneSnippet = {
			content: snippet,
			lines: lastLines.length,
			capturedAt: Date.now(),
		};

		const event: SettledEvent = {
			runId: task.taskId,
			toolName: "send_to_agent",
			summary: task.summary,
			pane,
		};

		this.onSettled(event);
	}
}
