import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateDetector } from "../../src/tmux/state-detector.js";
import type { TmuxBridge } from "../../src/tmux/bridge.js";
import type { LLMClient } from "../../src/llm/client.js";
import type { PromptLoader } from "../../src/llm/prompt-loader.js";
import type { AgentCharacteristics } from "../../src/agents/adapter.js";

function createMockBridge(): TmuxBridge {
	return {
		capturePane: vi.fn().mockResolvedValue({
			content: "> ",
			lines: ["> "],
			timestamp: Date.now(),
		}),
	} as any;
}

function createMockLLM(): LLMClient {
	return {
		completeJson: vi.fn().mockResolvedValue({
			status: "completed",
			confidence: 0.9,
			detail: "Task completed",
		}),
	} as any;
}

function createMockPromptLoader(): PromptLoader {
	return {
		resolve: vi.fn().mockReturnValue("system prompt"),
	} as any;
}

const characteristics: AgentCharacteristics = {
	waitingPatterns: [/^>\s*$/m],
	completionPatterns: [/^>\s*$/m],
	errorPatterns: [/Error:/i],
	activePatterns: [/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/],
	confirmKey: "y",
	abortKey: "Escape",
};

describe("StateDetector cooldown", () => {
	let bridge: ReturnType<typeof createMockBridge>;
	let llm: LLMClient;
	let promptLoader: PromptLoader;
	let detector: StateDetector;

	beforeEach(() => {
		bridge = createMockBridge();
		llm = createMockLLM();
		promptLoader = createMockPromptLoader();
		detector = new StateDetector(bridge as any, llm, {
			pollIntervalMs: 100,
			stableThresholdMs: 2000,
			captureLines: 50,
		}, promptLoader);
		detector.setCharacteristics(characteristics);
	});

	it("should ignore completion pattern during cooldown", async () => {
		const callback = vi.fn();
		detector.onStateChange(callback);

		// Set a long cooldown
		detector.setCooldown(5000);

		// Start monitoring — pane shows "> " (completion pattern)
		detector.startMonitoring("test:0.0", "test task");

		// Wait for one poll cycle
		await new Promise((r) => setTimeout(r, 200));

		detector.stopMonitoring();

		// Callback should NOT have been called with "completed" or "waiting_input"
		// because we're in cooldown. The only allowed status during cooldown is "error".
		for (const call of callback.mock.calls) {
			const analysis = call[0];
			expect(analysis.status).not.toBe("completed");
			expect(analysis.status).not.toBe("waiting_input");
		}
	});

	it("should detect completion after cooldown expires", async () => {
		const callback = vi.fn();
		detector.onStateChange(callback);

		// Set a very short cooldown (50ms)
		detector.setCooldown(50);

		// Start monitoring
		detector.startMonitoring("test:0.0", "test task");

		// Wait for cooldown to expire + a poll cycle
		await new Promise((r) => setTimeout(r, 300));

		detector.stopMonitoring();

		// After cooldown, the "> " pattern should trigger a state change
		// It may be either waiting_input or completed depending on quickPatternCheck
		const statuses = callback.mock.calls.map((c: any) => c[0].status);
		expect(statuses.some((s: string) => s === "waiting_input" || s === "completed")).toBe(true);
	});

	it("should still detect errors during cooldown", async () => {
		// Return error content during cooldown
		bridge.capturePane = vi.fn().mockResolvedValue({
			content: "Error: something went wrong",
			lines: ["Error: something went wrong"],
			timestamp: Date.now(),
		});

		const callback = vi.fn();
		detector.onStateChange(callback);

		detector.setCooldown(5000);
		detector.startMonitoring("test:0.0", "test task");

		await new Promise((r) => setTimeout(r, 200));

		detector.stopMonitoring();

		// Error should be detected even during cooldown
		const statuses = callback.mock.calls.map((c: any) => c[0].status);
		expect(statuses).toContain("error");
	});
});
