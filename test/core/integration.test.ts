import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextManager } from "../../src/core/context-manager.js";
import { MainAgent } from "../../src/core/main-agent.js";
import { SignalRouter } from "../../src/core/signal-router.js";
import { Scheduler } from "../../src/core/scheduler.js";
import { TaskGraph, type Task, type TaskResult } from "../../src/core/task.js";
import type { AgentAdapter, AgentCharacteristics } from "../../src/agents/adapter.js";
import type { LLMClient } from "../../src/llm/client.js";
import type { TmuxBridge } from "../../src/tmux/bridge.js";
import type { StateDetector } from "../../src/tmux/state-detector.js";
import type { Planner } from "../../src/core/planner.js";
import type { PromptLoader } from "../../src/llm/prompt-loader.js";

/**
 * Integration test: simulates the full Goal → Plan → Execute → Monitor → Complete flow
 * through the MainAgent architecture.
 *
 * Components wired together:
 *   ContextManager (real) ← SignalRouter (real) ← MainAgent (real) ← Scheduler (real)
 *   LLMClient, Adapter, Bridge, StateDetector, Planner, PromptLoader (mocked)
 */

function createMockPromptLoader(): PromptLoader {
	return {
		getRaw: vi.fn().mockReturnValue("You are the Main Agent. Goal: {{goal}}\nTasks: {{task_graph_summary}}\nHistory: {{compressed_history}}\nMemory: {{memory}}"),
		resolve: vi.fn().mockReturnValue("compressor prompt"),
		load: vi.fn().mockResolvedValue(undefined),
		setGlobalContext: vi.fn(),
	} as any;
}

function createMockLLMClient(responses: any[]) {
	let callCount = 0;
	return {
		complete: vi.fn().mockImplementation(() => {
			const response = responses[callCount] ?? {
				content: "No more responses",
				contentBlocks: [{ type: "text", text: "No more responses" }],
				usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
				stopReason: "end_turn",
				model: "test",
			};
			callCount++;
			return Promise.resolve(response);
		}),
		completeJson: vi.fn(),
		getModel: vi.fn().mockReturnValue("test-model"),
	} as any;
}

function createMockAdapter(): AgentAdapter {
	return {
		name: "mock",
		displayName: "Mock Agent",
		launch: vi.fn().mockResolvedValue("test-session:0.0"),
		sendPrompt: vi.fn().mockResolvedValue(undefined),
		sendResponse: vi.fn().mockResolvedValue(undefined),
		abort: vi.fn(),
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
	return {
		capturePane: vi.fn().mockResolvedValue({
			content: "mock pane content\n".repeat(50),
			lines: 50,
			timestamp: Date.now(),
		}),
	} as any;
}

function createMockStateDetector() {
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
		startMonitoring: vi.fn(),
		stopMonitoring: vi.fn(),
		analyzeState: vi.fn(),
		deepAnalyze: vi.fn(),
		_callbacks: callbacks,
	} as any;
}

function createMockPlanner(): Planner {
	return {
		plan: vi.fn(),
		replan: vi.fn().mockResolvedValue(new TaskGraph()),
	} as any;
}

describe("Integration: MainAgent architecture end-to-end", () => {
	let promptLoader: ReturnType<typeof createMockPromptLoader>;
	let adapter: AgentAdapter;
	let bridge: ReturnType<typeof createMockBridge>;
	let stateDetector: ReturnType<typeof createMockStateDetector>;
	let planner: ReturnType<typeof createMockPlanner>;

	beforeEach(() => {
		promptLoader = createMockPromptLoader();
		adapter = createMockAdapter();
		bridge = createMockBridge();
		stateDetector = createMockStateDetector();
		planner = createMockPlanner();
	});

	it("should complete a single task via send_to_agent → fast-path completion", async () => {
		// LLM responds: call send_to_agent → then end_turn (waiting for monitoring)
		const llmClient = createMockLLMClient([
			{
				content: "",
				contentBlocks: [
					{ type: "tool_call", id: "tc1", name: "send_to_agent", arguments: { prompt: "Implement the feature" } },
				],
				usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
				stopReason: "tool_use",
				model: "test",
			},
			{
				content: "Waiting for agent",
				contentBlocks: [{ type: "text", text: "Waiting for agent" }],
				usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
				stopReason: "end_turn",
				model: "test",
			},
		]);

		// Wire up real components
		const contextManager = new ContextManager({ llmClient, promptLoader });
		contextManager.updateModule("goal", "Build a feature");

		const taskGraph = new TaskGraph();
		const task: Task = {
			id: "1",
			title: "Implement feature X",
			description: "Add feature X to the project",
			status: "pending",
			dependencies: [],
			attempts: 0,
			maxAttempts: 3,
			estimatedComplexity: "medium",
			createdAt: Date.now(),
		};
		taskGraph.addTask(task);

		const signalRouter = new SignalRouter(stateDetector as any, bridge, contextManager, taskGraph);

		const mainAgent = new MainAgent({
			contextManager,
			signalRouter,
			llmClient,
			planner,
			adapter,
			bridge,
			stateDetector: stateDetector as any,
			taskGraph,
			goal: "Build a feature",
		});

		const agents = new Map([["mock", adapter]]);
		const scheduler = new Scheduler(
			taskGraph,
			bridge as any,
			stateDetector as any,
			mainAgent,
			agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "Build a feature" },
		);

		// Track events
		const events: string[] = [];
		scheduler.on("task_start", (t) => events.push(`start:${t.id}`));
		scheduler.on("task_complete", (t) => events.push(`complete:${t.id}`));
		scheduler.on("all_complete", () => events.push("all_complete"));

		// Start execution
		const startPromise = scheduler.start();

		// Wait for the monitoring to start
		await new Promise((r) => setTimeout(r, 100));

		// Simulate fast-path completion from StateDetector
		for (const cb of stateDetector._callbacks) {
			cb(
				{ status: "completed", confidence: 0.95, detail: "Agent finished the task" },
				"> ",
			);
		}

		await startPromise;

		// Verify the flow
		expect(adapter.launch).toHaveBeenCalledTimes(1);
		expect(adapter.sendPrompt).toHaveBeenCalledWith(bridge, "test-session:0.0", "Implement the feature");
		expect(stateDetector.setCooldown).toHaveBeenCalledWith(3000);
		expect(taskGraph.getTask("1")?.status).toBe("completed");
		expect(events).toContain("start:1");
		expect(events).toContain("complete:1");
		expect(events).toContain("all_complete");
	});

	it("should complete a task via mark_complete tool (terminal tool)", async () => {
		// LLM immediately calls mark_complete
		const llmClient = createMockLLMClient([
			{
				content: "",
				contentBlocks: [
					{ type: "tool_call", id: "tc1", name: "mark_complete", arguments: { summary: "Feature implemented successfully" } },
				],
				usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
				stopReason: "tool_use",
				model: "test",
			},
		]);

		const contextManager = new ContextManager({ llmClient, promptLoader });
		const taskGraph = new TaskGraph();
		taskGraph.addTask({
			id: "1",
			title: "Simple task",
			description: "A simple task",
			status: "pending",
			dependencies: [],
			attempts: 0,
			maxAttempts: 3,
			estimatedComplexity: "low",
			createdAt: Date.now(),
		});

		const signalRouter = new SignalRouter(stateDetector as any, bridge, contextManager, taskGraph);
		const mainAgent = new MainAgent({
			contextManager, signalRouter, llmClient, planner,
			adapter, bridge, stateDetector: stateDetector as any,
			taskGraph, goal: "Test",
		});

		const agents = new Map([["mock", adapter]]);
		const scheduler = new Scheduler(
			taskGraph, bridge as any, stateDetector as any, mainAgent, agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "Test" },
		);

		await scheduler.start();

		expect(taskGraph.getTask("1")?.status).toBe("completed");
		expect(taskGraph.getTask("1")?.result?.summary).toBe("Feature implemented successfully");
	});

	it("should execute two sequential tasks", async () => {
		let llmCallCount = 0;
		const llmClient = createMockLLMClient([]);
		// Override to always return mark_complete
		(llmClient.complete as any).mockImplementation(() => {
			llmCallCount++;
			return Promise.resolve({
				content: "",
				contentBlocks: [
					{ type: "tool_call", id: `tc${llmCallCount}`, name: "mark_complete", arguments: { summary: `Task ${llmCallCount} done` } },
				],
				usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
				stopReason: "tool_use",
				model: "test",
			});
		});

		const contextManager = new ContextManager({ llmClient, promptLoader });
		const taskGraph = new TaskGraph();
		taskGraph.addTask({
			id: "1", title: "Task 1", description: "First task",
			status: "pending", dependencies: [], attempts: 0, maxAttempts: 3,
			estimatedComplexity: "low", createdAt: Date.now(),
		});
		taskGraph.addTask({
			id: "2", title: "Task 2", description: "Second task",
			status: "pending", dependencies: ["1"], attempts: 0, maxAttempts: 3,
			estimatedComplexity: "low", createdAt: Date.now(),
		});

		const signalRouter = new SignalRouter(stateDetector as any, bridge, contextManager, taskGraph);
		const mainAgent = new MainAgent({
			contextManager, signalRouter, llmClient, planner,
			adapter, bridge, stateDetector: stateDetector as any,
			taskGraph, goal: "Do two things",
		});

		const agents = new Map([["mock", adapter]]);
		const scheduler = new Scheduler(
			taskGraph, bridge as any, stateDetector as any, mainAgent, agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "Do two things" },
		);

		const completedTasks: string[] = [];
		scheduler.on("task_complete", (t) => completedTasks.push(t.id));

		await scheduler.start();

		expect(completedTasks).toEqual(["1", "2"]);
		expect(taskGraph.getTask("1")?.status).toBe("completed");
		expect(taskGraph.getTask("2")?.status).toBe("completed");
	});

	it("should handle multi-step tool use: fetch_more → send_to_agent → monitor → complete", async () => {
		const llmClient = createMockLLMClient([
			// Step 1: fetch_more
			{
				content: "",
				contentBlocks: [
					{ type: "tool_call", id: "tc1", name: "fetch_more", arguments: { lines: 200 } },
				],
				usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
				stopReason: "tool_use",
				model: "test",
			},
			// Step 2: send_to_agent after seeing extended content
			{
				content: "",
				contentBlocks: [
					{ type: "tool_call", id: "tc2", name: "send_to_agent", arguments: { prompt: "Fix the bug based on the error I see" } },
				],
				usage: { inputTokens: 300, outputTokens: 50, totalTokens: 350 },
				stopReason: "tool_use",
				model: "test",
			},
			// Step 3: end_turn — wait for monitoring
			{
				content: "Monitoring agent...",
				contentBlocks: [{ type: "text", text: "Monitoring agent..." }],
				usage: { inputTokens: 300, outputTokens: 10, totalTokens: 310 },
				stopReason: "end_turn",
				model: "test",
			},
		]);

		const contextManager = new ContextManager({ llmClient, promptLoader });
		const taskGraph = new TaskGraph();
		taskGraph.addTask({
			id: "1", title: "Debug task", description: "Fix a bug",
			status: "pending", dependencies: [], attempts: 0, maxAttempts: 3,
			estimatedComplexity: "medium", createdAt: Date.now(),
		});

		const signalRouter = new SignalRouter(stateDetector as any, bridge, contextManager, taskGraph);
		const mainAgent = new MainAgent({
			contextManager, signalRouter, llmClient, planner,
			adapter, bridge, stateDetector: stateDetector as any,
			taskGraph, goal: "Fix bugs",
		});

		const agents = new Map([["mock", adapter]]);
		const scheduler = new Scheduler(
			taskGraph, bridge as any, stateDetector as any, mainAgent, agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "Fix bugs" },
		);

		const startPromise = scheduler.start();
		await new Promise((r) => setTimeout(r, 100));

		// Simulate completion from StateDetector
		for (const cb of stateDetector._callbacks) {
			cb(
				{ status: "completed", confidence: 0.95, detail: "Bug fixed" },
				"> ",
			);
		}

		await startPromise;

		// Verify multi-step flow
		expect(bridge.capturePane).toHaveBeenCalledWith("test-session:0.0", { startLine: -200 });
		expect(adapter.sendPrompt).toHaveBeenCalledWith(bridge, "test-session:0.0", "Fix the bug based on the error I see");
		expect(taskGraph.getTask("1")?.status).toBe("completed");
	});

	it("should handle task failure via mark_failed tool", async () => {
		const llmClient = createMockLLMClient([
			{
				content: "",
				contentBlocks: [
					{ type: "tool_call", id: "tc1", name: "mark_failed", arguments: { reason: "Cannot resolve dependency" } },
				],
				usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
				stopReason: "tool_use",
				model: "test",
			},
		]);

		const contextManager = new ContextManager({ llmClient, promptLoader });
		const taskGraph = new TaskGraph();
		taskGraph.addTask({
			id: "1", title: "Failing task", description: "This will fail",
			status: "pending", dependencies: [], attempts: 0, maxAttempts: 3,
			estimatedComplexity: "high", createdAt: Date.now(),
		});

		const signalRouter = new SignalRouter(stateDetector as any, bridge, contextManager, taskGraph);
		const mainAgent = new MainAgent({
			contextManager, signalRouter, llmClient, planner,
			adapter, bridge, stateDetector: stateDetector as any,
			taskGraph, goal: "Attempt something",
		});

		const agents = new Map([["mock", adapter]]);
		const scheduler = new Scheduler(
			taskGraph, bridge as any, stateDetector as any, mainAgent, agents,
			{ maxParallel: 1, autonomyLevel: "high", defaultAgent: "mock", goal: "Attempt something" },
		);

		const failedTasks: string[] = [];
		scheduler.on("task_failed", (t) => failedTasks.push(t.id));

		await scheduler.start();

		expect(taskGraph.getTask("1")?.status).toBe("failed");
		expect(failedTasks).toEqual(["1"]);
	});
});
