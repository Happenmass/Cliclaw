import { describe, it, expect, beforeEach, vi } from "vitest";
import { ContextManager } from "../../src/core/context-manager.js";

function createMockPromptLoader(template: string) {
	return {
		getRaw: vi.fn().mockReturnValue(template),
		resolve: vi.fn().mockReturnValue("You are a history compressor."),
		load: vi.fn(),
		setGlobalContext: vi.fn(),
	} as any;
}

function createMockLLMClient(compressedResult = "## Completed Tasks\n- #1 Setup: done") {
	return {
		complete: vi.fn().mockResolvedValue({ content: compressedResult }),
		completeJson: vi.fn(),
		stream: vi.fn(),
	} as any;
}

describe("ContextManager", () => {
	let contextManager: ContextManager;
	let mockLLM: ReturnType<typeof createMockLLMClient>;
	let mockPromptLoader: ReturnType<typeof createMockPromptLoader>;

	const template = "Goal: {{goal}}\nTasks: {{task_graph_summary}}\nHistory: {{compressed_history}}\nMemory: {{memory}}";

	beforeEach(() => {
		mockLLM = createMockLLMClient();
		mockPromptLoader = createMockPromptLoader(template);
		contextManager = new ContextManager({
			llmClient: mockLLM,
			promptLoader: mockPromptLoader,
		});
	});

	describe("module replacement", () => {
		it("should replace template variables with module values", () => {
			contextManager.updateModule("goal", "Build an API");
			contextManager.updateModule("task_graph_summary", "[✓]#1 [ ]#2");

			const prompt = contextManager.getSystemPrompt();
			expect(prompt).toContain("Goal: Build an API");
			expect(prompt).toContain("Tasks: [✓]#1 [ ]#2");
		});

		it("should clear unreplaced variables", () => {
			contextManager.updateModule("goal", "Test");

			const prompt = contextManager.getSystemPrompt();
			expect(prompt).not.toContain("{{");
			expect(prompt).toContain("Goal: Test");
			expect(prompt).toContain("History: ");
		});

		it("should update modules dynamically", () => {
			contextManager.updateModule("goal", "v1");
			expect(contextManager.getSystemPrompt()).toContain("Goal: v1");

			contextManager.updateModule("goal", "v2");
			expect(contextManager.getSystemPrompt()).toContain("Goal: v2");
		});
	});

	describe("conversation management", () => {
		it("should start with empty conversation", () => {
			expect(contextManager.getMessages()).toHaveLength(0);
		});

		it("should add messages to conversation", () => {
			contextManager.addMessage({ role: "user", content: "hello" });
			contextManager.addMessage({ role: "assistant", content: "hi" });

			const msgs = contextManager.getMessages();
			expect(msgs).toHaveLength(2);
			expect(msgs[0].role).toBe("user");
			expect(msgs[1].role).toBe("assistant");
		});

		it("should track conversation length", () => {
			expect(contextManager.getConversationLength()).toBe(0);
			contextManager.addMessage({ role: "user", content: "test" });
			expect(contextManager.getConversationLength()).toBe(1);
		});
	});

	describe("shouldCompress", () => {
		it("should return false when under threshold", () => {
			contextManager.addMessage({ role: "user", content: "short message" });
			expect(contextManager.shouldCompress()).toBe(false);
		});

		it("should return true when over threshold", () => {
			// With default 128000 limit and 0.7 threshold = 89600 tokens
			// Each char ~0.25 tokens, so need ~358400 chars
			const longContent = "x".repeat(360000);
			contextManager.addMessage({ role: "user", content: longContent });
			expect(contextManager.shouldCompress()).toBe(true);
		});

		it("should respect custom thresholds", () => {
			const smallCtx = new ContextManager({
				llmClient: mockLLM,
				promptLoader: mockPromptLoader,
				contextWindowLimit: 1000,
				compressionThreshold: 0.5,
			});
			// Threshold: 1000 * 0.5 = 500 tokens = ~2000 chars
			smallCtx.addMessage({ role: "user", content: "x".repeat(2100) });
			expect(smallCtx.shouldCompress()).toBe(true);
		});
	});

	describe("compress", () => {
		it("should call LLM with conversation and existing history", async () => {
			contextManager.updateModule("goal", "Build API");
			contextManager.updateModule("task_graph_summary", "[✓]#1");
			contextManager.updateModule("compressed_history", "Previous context");
			contextManager.addMessage({ role: "user", content: "[TASK_READY] Task #2" });
			contextManager.addMessage({ role: "assistant", content: "Starting task" });

			await contextManager.compress();

			expect(mockLLM.complete).toHaveBeenCalledOnce();
			const callArgs = mockLLM.complete.mock.calls[0];
			const input = JSON.parse(callArgs[0][0].content);
			expect(input.existing_history).toBe("Previous context");
			expect(input.new_conversation).toHaveLength(2);
			expect(input.current_goal).toBe("Build API");
		});

		it("should update compressed_history module and clear conversation", async () => {
			contextManager.addMessage({ role: "user", content: "test" });
			contextManager.addMessage({ role: "user", content: "test2" });

			await contextManager.compress();

			expect(contextManager.getMessages()).toHaveLength(0);
			expect(contextManager.getSystemPrompt()).toContain("## Completed Tasks");
		});

		it("should handle empty existing history", async () => {
			contextManager.addMessage({ role: "user", content: "first message" });

			await contextManager.compress();

			const callArgs = mockLLM.complete.mock.calls[0];
			const input = JSON.parse(callArgs[0][0].content);
			expect(input.existing_history).toBe("");
		});
	});
});
