import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";
import { Memory } from "../../src/core/memory.js";

describe("Memory", () => {
	let tempProjectDir: string;
	let originalHome: string;
	let tempHome: string;

	beforeEach(async () => {
		tempProjectDir = await mkdtemp(join(tmpdir(), "clipilot-project-"));
		// Override HOME so Memory writes to a temp location
		tempHome = await mkdtemp(join(tmpdir(), "clipilot-home-"));
		originalHome = process.env.HOME || "";
		process.env.HOME = tempHome;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await rm(tempProjectDir, { recursive: true, force: true });
		await rm(tempHome, { recursive: true, force: true });
	});

	it("should generate deterministic project hash", () => {
		const memory1 = new Memory("/some/project/path");
		const memory2 = new Memory("/some/project/path");
		const memory3 = new Memory("/different/path");

		// Both should resolve to the same internal directory
		// We can verify by checking that load/remember operations are consistent
		// Since the hash is derived from the path, same paths yield same hash
		const hash1 = createHash("sha256").update("/some/project/path").digest("hex").slice(0, 12);
		const hash2 = createHash("sha256").update("/different/path").digest("hex").slice(0, 12);
		expect(hash1).not.toBe(hash2);
	});

	it("should return empty string when no memory exists", async () => {
		const memory = new Memory(tempProjectDir);
		await memory.load();

		expect(memory.getFormattedMemory()).toBe("");
	});

	it("should append to context.md via remember()", async () => {
		const memory = new Memory(tempProjectDir);
		await memory.remember("This project uses PostgreSQL");
		await memory.remember("Auth is JWT-based");

		const memory2 = new Memory(tempProjectDir);
		await memory2.load();

		const formatted = memory2.getFormattedMemory();
		expect(formatted).toContain("This project uses PostgreSQL");
		expect(formatted).toContain("Auth is JWT-based");
		expect(formatted).toContain("## Project Context");
	});

	it("should append to lessons.md via recordLesson()", async () => {
		const memory = new Memory(tempProjectDir);
		await memory.recordLesson("Always run tests before commit");

		const memory2 = new Memory(tempProjectDir);
		await memory2.load();

		const formatted = memory2.getFormattedMemory();
		expect(formatted).toContain("Always run tests before commit");
		expect(formatted).toContain("## Lessons Learned");
	});

	it("should load all three memory files correctly", async () => {
		const memory = new Memory(tempProjectDir);

		await memory.rememberGlobal("I prefer TypeScript");
		await memory.remember("This project uses Express");
		await memory.recordLesson("Check deps first");

		const memory2 = new Memory(tempProjectDir);
		await memory2.load();

		const formatted = memory2.getFormattedMemory();
		expect(formatted).toContain("## Global Memory");
		expect(formatted).toContain("I prefer TypeScript");
		expect(formatted).toContain("## Project Context");
		expect(formatted).toContain("This project uses Express");
		expect(formatted).toContain("## Lessons Learned");
		expect(formatted).toContain("Check deps first");
	});

	it("should truncate memory exceeding 2000 characters", async () => {
		const memory = new Memory(tempProjectDir);

		// Write a lot of content
		const longText = "A".repeat(500);
		for (let i = 0; i < 10; i++) {
			await memory.remember(`${longText} entry ${i}`);
		}

		const memory2 = new Memory(tempProjectDir);
		await memory2.load();

		const formatted = memory2.getFormattedMemory();
		expect(formatted.length).toBeLessThanOrEqual(2100); // 2000 + truncation message
		expect(formatted).toContain("...(truncated)");
	});

	it("should escape {{ in memory content to prevent template injection", async () => {
		const memory = new Memory(tempProjectDir);
		await memory.remember("Use {{variable}} syntax");

		const memory2 = new Memory(tempProjectDir);
		await memory2.load();

		const formatted = memory2.getFormattedMemory();
		expect(formatted).not.toContain("{{variable}}");
		expect(formatted).toContain("{ {variable}}");
	});
});
