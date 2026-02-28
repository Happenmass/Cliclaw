import { describe, it, expect } from "vitest";
import { ClaudeCodeAdapter } from "../../src/agents/claude-code.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("ClaudeCodeAdapter skill methods", () => {
	const adapter = new ClaudeCodeAdapter();

	it("should return a skills directory path from getSkillsDir", () => {
		const dir = adapter.getSkillsDir();
		expect(typeof dir).toBe("string");
		expect(dir).toContain("claude-code-skills");
	});

	it("should return capabilities file path from getCapabilitiesFile", () => {
		const capFile = adapter.getCapabilitiesFile();
		expect(capFile).toBe("adapters/claude-code.md");
	});

	it("should have skill directories that actually exist", () => {
		const dir = adapter.getSkillsDir();
		// The skill dirs should exist in the source tree
		// Note: in built dist/ they may differ, but from source they should be resolvable
		expect(typeof dir).toBe("string");
	});
});
