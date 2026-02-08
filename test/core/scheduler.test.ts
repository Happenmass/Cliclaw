import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scheduler } from "../../src/core/scheduler.js";
import { TaskGraph, type Task } from "../../src/core/task.js";
import type { TmuxBridge } from "../../src/tmux/bridge.js";
import type { StateDetector } from "../../src/tmux/state-detector.js";
import type { Planner } from "../../src/core/planner.js";
import type { AgentAdapter, AgentCharacteristics } from "../../src/agents/adapter.js";

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
	const callbacks: Array<(analysis: any, content: string) => void> = [];
	return {
		setCharacteristics: vi.fn(),
		setCooldown: vi.fn(),
		onStateChange: vi.fn((cb: any) => {
			callbacks.push(cb);
			return () => {
				const idx = callbacks.indexOf(cb);
				if (idx >= 0) callbacks.splice(idx, 1);
			};
		}),
		startMonitoring: vi.fn((_pane: string, _ctx: string) => {
			// Simulate immediate completion
			for (const cb of callbacks) {
				cb({ status: "completed", confidence: 1, detail: "done" }, ">");
			}
		}),
		stopMonitoring: vi.fn(),
		analyzeState: vi.fn(),
		deepAnalyze: vi.fn(),
		// Expose callbacks for testing
		_callbacks: callbacks,
	} as any;
}

function createMockPlanner(): Planner {
	return {
		plan: vi.fn(),
		replan: vi.fn(),
		generatePrompt: vi.fn().mockResolvedValue("Do the task"),
	} as any;
}

describe("Scheduler", () => {
	let adapter: AgentAdapter;
	let bridge: TmuxBridge;
	let stateDetector: ReturnType<typeof createMockStateDetector>;
	let planner: Planner;

	beforeEach(() => {
		adapter = createMockAdapter();
		bridge = createMockBridge();
		stateDetector = createMockStateDetector();
		planner = createMockPlanner();
	});

	it("should launch agent only once for multiple tasks", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2" }));
		graph.addTask(makeTask({ id: "3", title: "Task 3" }));

		const agents = new Map([["mock", adapter]]);
		const scheduler = new Scheduler(
			graph,
			bridge,
			stateDetector as any,
			planner,
			agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "test goal" },
		);

		await scheduler.start();

		// launch() should be called exactly once
		expect(adapter.launch).toHaveBeenCalledTimes(1);

		// sendPrompt() should be called once per task
		expect(adapter.sendPrompt).toHaveBeenCalledTimes(3);

		// All three calls should use the same paneTarget
		const calls = (adapter.sendPrompt as any).mock.calls;
		expect(calls[0][1]).toBe("mock-session:0.0");
		expect(calls[1][1]).toBe("mock-session:0.0");
		expect(calls[2][1]).toBe("mock-session:0.0");
	});

	it("should call shutdown after all tasks complete", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));

		const agents = new Map([["mock", adapter]]);
		const scheduler = new Scheduler(
			graph,
			bridge,
			stateDetector as any,
			planner,
			agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "test goal" },
		);

		await scheduler.start();

		expect(adapter.shutdown).toHaveBeenCalledTimes(1);
		expect(adapter.shutdown).toHaveBeenCalledWith(bridge, "mock-session:0.0");
	});

	it("should set cooldown after each sendPrompt", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));

		const agents = new Map([["mock", adapter]]);
		const scheduler = new Scheduler(
			graph,
			bridge,
			stateDetector as any,
			planner,
			agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "test goal" },
		);

		await scheduler.start();

		expect(stateDetector.setCooldown).toHaveBeenCalledWith(3000);
	});

	it("should keep pane alive after task failure", async () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1", maxAttempts: 1 }));
		graph.addTask(makeTask({ id: "2", title: "Task 2", maxAttempts: 1 }));

		// Make first task fail (no retry since maxAttempts=1), second succeed
		let callCount = 0;
		stateDetector.startMonitoring = vi.fn((_pane: string, _ctx: string) => {
			callCount++;
			for (const cb of stateDetector._callbacks) {
				if (callCount === 1) {
					cb({ status: "error", confidence: 0.9, detail: "error occurred", suggestedAction: { type: "escalate" } }, "Error: something");
				} else {
					cb({ status: "completed", confidence: 1, detail: "done" }, ">");
				}
			}
		});

		const agents = new Map([["mock", adapter]]);
		const scheduler = new Scheduler(
			graph,
			bridge,
			stateDetector as any,
			planner,
			agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "test goal" },
		);

		await scheduler.start();

		// launch still only called once despite failure
		expect(adapter.launch).toHaveBeenCalledTimes(1);
		// sendPrompt called for both tasks (first failed, second succeeded)
		expect(adapter.sendPrompt).toHaveBeenCalledTimes(2);
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
			planner,
			agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "test goal" },
		);

		// Should not throw
		await scheduler.start();
		expect(graph.getTask("1")?.status).toBe("completed");
	});
});
