import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scheduler } from "../../src/core/scheduler.js";
import { TaskGraph, type Task, type TaskResult } from "../../src/core/task.js";
import type { TmuxBridge } from "../../src/tmux/bridge.js";
import type { StateDetector } from "../../src/tmux/state-detector.js";
import type { MainAgent } from "../../src/core/main-agent.js";
import type { AgentAdapter, AgentCharacteristics } from "../../src/agents/adapter.js";
import { EventEmitter } from "node:events";
import type { MainAgentEvents } from "../../src/core/main-agent.js";

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
	return {
		status: "pending",
		description: "",
		dependencies: [],
		attempts: 0,
		maxAttempts: 3,
		estimatedComplexity: "low",
		createdAt: Date.now(),
		...overrides,
	};
}

function createMockAdapter(): AgentAdapter {
	return {
		name: "mock",
		displayName: "Mock Agent",
		launch: vi.fn().mockResolvedValue("mock-session:0.0"),
		sendPrompt: vi.fn().mockResolvedValue(undefined),
		sendResponse: vi.fn().mockResolvedValue(undefined),
		abort: vi.fn().mockResolvedValue(undefined),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getCharacteristics: vi.fn().mockReturnValue({
			waitingPatterns: [/^>\s*$/m],
			completionPatterns: [/^>\s*$/m],
			errorPatterns: [/Error:/i],
			activePatterns: [/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/],
			confirmKey: "y",
			abortKey: "Escape",
		} satisfies AgentCharacteristics),
	};
}

function createMockBridge(): TmuxBridge {
	return {} as TmuxBridge;
}

function createMockStateDetector(): StateDetector {
	return {
		setCharacteristics: vi.fn(),
		setCooldown: vi.fn(),
		onStateChange: vi.fn().mockReturnValue(() => {}),
		startMonitoring: vi.fn(),
		stopMonitoring: vi.fn(),
		analyzeState: vi.fn(),
		deepAnalyze: vi.fn(),
	} as any;
}

function createMockMainAgent(
	executeResults?: TaskResult[],
): MainAgent & EventEmitter<MainAgentEvents> {
	const emitter = new EventEmitter<MainAgentEvents>();
	let callCount = 0;

	const agent = Object.assign(emitter, {
		setPaneTarget: vi.fn(),
		setTaskGraph: vi.fn(),
		executeTask: vi.fn().mockImplementation(async (_task: Task) => {
			const result = executeResults?.[callCount] ?? { success: true, summary: "Done" };
			callCount++;
			return result;
		}),
	});

	return agent as any;
}

describe("Scheduler", () => {
	let adapter: AgentAdapter;
	let bridge: TmuxBridge;
	let stateDetector: ReturnType<typeof createMockStateDetector>;
	let mainAgent: ReturnType<typeof createMockMainAgent>;

	beforeEach(() => {
		adapter = createMockAdapter();
		bridge = createMockBridge();
		stateDetector = createMockStateDetector();
		mainAgent = createMockMainAgent();
	});

	function createScheduler(graph: TaskGraph) {
		const agents = new Map([["mock", adapter]]);
		return new Scheduler(
			graph,
			bridge,
			stateDetector as any,
			mainAgent as any,
			agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "test goal" },
		);
	}

	it("should launch agent only once for multiple tasks", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2" }));
		graph.addTask(makeTask({ id: "3", title: "Task 3" }));

		const scheduler = createScheduler(graph);
		await scheduler.start();

		// launch() should be called exactly once
		expect(adapter.launch).toHaveBeenCalledTimes(1);
		// MainAgent.executeTask should be called once per task
		expect(mainAgent.executeTask).toHaveBeenCalledTimes(3);
	});

	it("should delegate task execution to MainAgent", async () => {
		const graph = new TaskGraph();
		const task = makeTask({ id: "1", title: "Task 1" });
		graph.addTask(task);

		const scheduler = createScheduler(graph);
		await scheduler.start();

		expect(mainAgent.executeTask).toHaveBeenCalledWith(
			expect.objectContaining({ id: "1", title: "Task 1" }),
		);
	});

	it("should set pane target on MainAgent after launch", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));

		const scheduler = createScheduler(graph);
		await scheduler.start();

		expect(mainAgent.setPaneTarget).toHaveBeenCalledWith("mock-session:0.0");
	});

	it("should call shutdown after all tasks complete", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));

		const scheduler = createScheduler(graph);
		await scheduler.start();

		expect(adapter.shutdown).toHaveBeenCalledTimes(1);
		expect(adapter.shutdown).toHaveBeenCalledWith(bridge, "mock-session:0.0");
	});

	it("should update task status based on MainAgent result", async () => {
		mainAgent = createMockMainAgent([
			{ success: true, summary: "Completed" },
			{ success: false, summary: "Failed", errors: ["some error"] },
		]);

		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2" }));

		const scheduler = createScheduler(graph);
		await scheduler.start();

		expect(graph.getTask("1")?.status).toBe("completed");
		expect(graph.getTask("2")?.status).toBe("failed");
	});

	it("should handle MainAgent executeTask throwing an error", async () => {
		mainAgent = createMockMainAgent();
		(mainAgent.executeTask as any).mockRejectedValueOnce(new Error("Unexpected crash"));

		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));

		const failSpy = vi.fn();
		const scheduler = createScheduler(graph);
		scheduler.on("task_failed", failSpy);

		await scheduler.start();

		expect(graph.getTask("1")?.status).toBe("failed");
		expect(failSpy).toHaveBeenCalled();
	});

	it("should skip shutdown if adapter does not implement it", async () => {
		const adapterNoShutdown = createMockAdapter();
		delete (adapterNoShutdown as any).shutdown;

		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));

		const agents = new Map([["mock", adapterNoShutdown]]);
		const scheduler = new Scheduler(
			graph,
			bridge,
			stateDetector as any,
			mainAgent as any,
			agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "test goal" },
		);

		// Should not throw
		await scheduler.start();
		expect(graph.getTask("1")?.status).toBe("completed");
	});

	it("should emit all_complete when all tasks finish", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));

		const allCompleteSpy = vi.fn();
		const scheduler = createScheduler(graph);
		scheduler.on("all_complete", allCompleteSpy);

		await scheduler.start();

		expect(allCompleteSpy).toHaveBeenCalledWith(
			expect.objectContaining({ completed: 1, total: 1 }),
		);
	});

	it("should forward MainAgent events", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));

		const logSpy = vi.fn();
		const scheduler = createScheduler(graph);
		scheduler.on("log", logSpy);

		// Emit a log event from MainAgent
		mainAgent.emit("log", "test log message");

		expect(logSpy).toHaveBeenCalledWith("test log message");
	});

	it("should stop if no agent adapter found", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));

		const agents = new Map<string, AgentAdapter>();
		const scheduler = new Scheduler(
			graph,
			bridge,
			stateDetector as any,
			mainAgent as any,
			agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "nonexistent", goal: "test" },
		);

		await scheduler.start();

		// Task should remain pending — never executed
		expect(graph.getTask("1")?.status).toBe("pending");
		expect(mainAgent.executeTask).not.toHaveBeenCalled();
	});

	it("should respect task dependencies", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2", dependencies: ["1"] }));

		const executionOrder: string[] = [];
		mainAgent = createMockMainAgent();
		(mainAgent.executeTask as any).mockImplementation(async (task: Task) => {
			executionOrder.push(task.id);
			return { success: true, summary: "Done" };
		});

		const scheduler = createScheduler(graph);
		await scheduler.start();

		expect(executionOrder).toEqual(["1", "2"]);
	});
});
