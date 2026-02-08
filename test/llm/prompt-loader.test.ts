import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { PromptLoader } from "../../src/llm/prompt-loader.js";
import { DEFAULT_PROMPTS } from "../../src/llm/prompts.js";

describe("PromptLoader", () => {
	let tempDir: string;
	let loader: PromptLoader;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "clipilot-test-"));
		loader = new PromptLoader();
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should return built-in defaults when no custom files exist", async () => {
		await loader.load(tempDir);

		const planner = loader.getRaw("planner");
		expect(planner).toBe(DEFAULT_PROMPTS.planner);

		const stateAnalyzer = loader.getRaw("state-analyzer");
		expect(stateAnalyzer).toBe(DEFAULT_PROMPTS["state-analyzer"]);

		const errorAnalyzer = loader.getRaw("error-analyzer");
		expect(errorAnalyzer).toBe(DEFAULT_PROMPTS["error-analyzer"]);

		const promptGenerator = loader.getRaw("prompt-generator");
		expect(promptGenerator).toBe(DEFAULT_PROMPTS["prompt-generator"]);

		const sessionSummarizer = loader.getRaw("session-summarizer");
		expect(sessionSummarizer).toBe(DEFAULT_PROMPTS["session-summarizer"]);
	});

	it("should override with project-level .md files", async () => {
		const promptsDir = join(tempDir, ".clipilot", "prompts");
		await mkdir(promptsDir, { recursive: true });
		await writeFile(join(promptsDir, "planner.md"), "Custom planner prompt");

		await loader.load(tempDir);

		expect(loader.getRaw("planner")).toBe("Custom planner prompt");
		// Other prompts should remain default
		expect(loader.getRaw("state-analyzer")).toBe(DEFAULT_PROMPTS["state-analyzer"]);
	});

	it("should replace template variables in resolve()", async () => {
		await loader.load(tempDir);

		const result = loader.resolve("planner", { memory: "some memory content" });
		expect(result).toContain("some memory content");
		expect(result).not.toContain("{{memory}}");
	});

	it("should replace unmatched variables with empty string", async () => {
		await loader.load(tempDir);

		const result = loader.resolve("planner");
		expect(result).not.toContain("{{memory}}");
	});

	it("should merge global context via setGlobalContext()", async () => {
		await loader.load(tempDir);

		loader.setGlobalContext({ memory: "global memory" });
		const result = loader.resolve("planner");
		expect(result).toContain("global memory");
	});

	it("should prioritize call-time context over global context", async () => {
		await loader.load(tempDir);

		loader.setGlobalContext({ memory: "global memory" });
		const result = loader.resolve("planner", { memory: "call-time memory" });
		expect(result).toContain("call-time memory");
		expect(result).not.toContain("global memory");
	});

	it("should return empty string for unknown prompt names", async () => {
		await loader.load(tempDir);

		// TypeScript wouldn't normally allow this, but testing runtime behavior
		const result = loader.getRaw("nonexistent" as any);
		expect(result).toBe("");
	});
});
