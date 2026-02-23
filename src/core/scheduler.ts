import { EventEmitter } from "node:events";
import type { AgentAdapter } from "../agents/adapter.js";
import type { TmuxBridge } from "../tmux/bridge.js";
import type { StateDetector } from "../tmux/state-detector.js";
import { logger } from "../utils/logger.js";
import type { MainAgent } from "./main-agent.js";
import type { Task, TaskGraph, TaskResult } from "./task.js";

export interface SchedulerOptions {
	maxParallel: number;
	autonomyLevel: "low" | "medium" | "high" | "full";
	defaultAgent: string;
	goal: string;
}

export interface SchedulerEvents {
	task_start: [task: Task];
	task_complete: [task: Task, result: TaskResult];
	task_failed: [task: Task, error: string];
	need_human: [task: Task, reason: string];
	all_complete: [progress: ReturnType<TaskGraph["getProgress"]>];
	log: [message: string];
	plan_ready: [taskGraph: TaskGraph];
}

export class Scheduler extends EventEmitter<SchedulerEvents> {
	private taskGraph: TaskGraph;
	private bridge: TmuxBridge;
	private stateDetector: StateDetector;
	private mainAgent: MainAgent;
	private agents: Map<string, AgentAdapter>;
	private options: SchedulerOptions;

	private running = false;
	private paused = false;
	private aborted = false;
	private agentPaneTarget: string | null = null;

	constructor(
		taskGraph: TaskGraph,
		bridge: TmuxBridge,
		stateDetector: StateDetector,
		mainAgent: MainAgent,
		agents: Map<string, AgentAdapter>,
		options: SchedulerOptions,
	) {
		super();
		this.taskGraph = taskGraph;
		this.bridge = bridge;
		this.stateDetector = stateDetector;
		this.mainAgent = mainAgent;
		this.agents = agents;
		this.options = options;

		// Forward MainAgent events
		this.mainAgent.on("task_start", (task) => this.emit("task_start", task));
		this.mainAgent.on("task_complete", (task, result) => this.emit("task_complete", task, result));
		this.mainAgent.on("task_failed", (task, error) => this.emit("task_failed", task, error));
		this.mainAgent.on("need_human", (task, reason) => this.emit("need_human", task, reason));
		this.mainAgent.on("log", (message) => this.emit("log", message));
	}

	getTaskGraph(): TaskGraph {
		return this.taskGraph;
	}

	isRunning(): boolean {
		return this.running;
	}

	isPaused(): boolean {
		return this.paused;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.paused = false;
		this.aborted = false;

		logger.info("scheduler", "Starting task execution");
		this.emit("log", "Scheduler started");

		const agentName = this.options.defaultAgent;
		const adapter = this.agents.get(agentName);

		if (!adapter) {
			logger.error("scheduler", `No adapter found for agent: ${agentName}`);
			this.emit("log", `Fatal error: No adapter for agent: ${agentName}`);
			this.running = false;
			return;
		}

		try {
			// Launch agent once — all tasks reuse this pane
			const sessionName = generateSessionName(this.options.goal);
			this.agentPaneTarget = await adapter.launch(this.bridge, {
				workingDir: process.cwd(),
				sessionName,
			});
			logger.info("scheduler", `Agent launched in ${this.agentPaneTarget}`);
			this.stateDetector.setCharacteristics(adapter.getCharacteristics());
			this.mainAgent.setPaneTarget(this.agentPaneTarget);

			await this.runLoop();
		} catch (err: any) {
			logger.error("scheduler", `Fatal error: ${err.message}`);
			this.emit("log", `Fatal error: ${err.message}`);
		} finally {
			// Gracefully shut down agent
			if (this.agentPaneTarget && adapter.shutdown) {
				try {
					await adapter.shutdown(this.bridge, this.agentPaneTarget);
					logger.info("scheduler", "Agent shut down gracefully");
				} catch (err: any) {
					logger.warn("scheduler", `Agent shutdown failed: ${err.message}`);
				}
			}
			this.agentPaneTarget = null;
			this.running = false;
		}
	}

	pause(): void {
		this.paused = true;
		logger.info("scheduler", "Paused");
		this.emit("log", "Scheduler paused");
	}

	resume(): void {
		this.paused = false;
		logger.info("scheduler", "Resumed");
		this.emit("log", "Scheduler resumed");
	}

	abort(): void {
		this.aborted = true;
		this.running = false;
		logger.info("scheduler", "Aborted");
		this.emit("log", "Scheduler aborted");
	}

	async steer(instruction: string): Promise<void> {
		logger.info("scheduler", `Steer instruction: ${instruction}`);
		this.emit("log", `User instruction: ${instruction}`);
	}

	private async runLoop(): Promise<void> {
		while (!this.aborted && !this.taskGraph.isComplete()) {
			// Wait if paused
			while (this.paused && !this.aborted) {
				await sleep(500);
			}
			if (this.aborted) break;

			// Check for deadlock
			if (this.taskGraph.isDeadlocked()) {
				logger.error("scheduler", "Task graph is deadlocked — no tasks can proceed");
				this.emit("log", "DEADLOCK: No tasks can proceed. Stopping.");
				break;
			}

			// Get ready tasks
			const readyTasks = this.taskGraph.getReadyTasks();
			if (readyTasks.length === 0) {
				// No ready tasks but some are running — wait
				if (this.taskGraph.getRunningTasks().length > 0) {
					await sleep(1000);
					continue;
				}
				break;
			}

			// Execute next ready task — delegated to MainAgent
			const task = readyTasks[0];
			this.taskGraph.updateStatus(task.id, "running");

			try {
				const result = await this.mainAgent.executeTask(task);
				this.taskGraph.updateStatus(task.id, result.success ? "completed" : "failed", result);
			} catch (err: any) {
				const result: TaskResult = {
					success: false,
					summary: `Execution error: ${err.message}`,
					errors: [err.message],
				};
				this.taskGraph.updateStatus(task.id, "failed", result);
				this.emit("task_failed", task, err.message);
				this.emit("log", `Task error: ${task.title} — ${err.message}`);
			}
		}

		if (!this.aborted) {
			const progress = this.taskGraph.getProgress();
			this.emit("all_complete", progress);
			logger.info("scheduler", `All tasks complete: ${progress.completed}/${progress.total} succeeded`);
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateSessionName(goal: string): string {
	const slug = goal
		.replace(/[^\w\u4e00-\u9fff]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 30)
		.replace(/-$/, "");
	return `clipilot-${slug || "session"}`;
}
