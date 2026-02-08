import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("node:util", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:util")>();
	return {
		...actual,
		promisify: (fn: Function) => {
			// Return a wrapper that calls the mocked execFile with a callback-style → promise conversion
			return (...args: unknown[]) =>
				new Promise((resolve, reject) => {
					fn(...args, (err: Error | null, result: unknown) => {
						if (err) reject(err);
						else resolve(result);
					});
				});
		},
	};
});

import { execFile } from "node:child_process";
import { checkTmux } from "../../../src/doctor/checks/tmux.js";

const execFileMock = vi.mocked(execFile);

function mockExecFileResult(stdout: string) {
	execFileMock.mockImplementation((...args: any[]) => {
		const cb = args[args.length - 1];
		if (typeof cb === "function") {
			cb(null, { stdout, stderr: "" });
		}
	});
}

function mockExecFileError(err: Error) {
	execFileMock.mockImplementation((...args: any[]) => {
		const cb = args[args.length - 1];
		if (typeof cb === "function") {
			cb(err);
		}
	});
}

describe("checkTmux", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should return pass when tmux version meets minimum (3.2a)", async () => {
		mockExecFileResult("tmux 3.2a\n");
		const result = await checkTmux();
		expect(result).toEqual({
			name: "tmux",
			status: "pass",
			message: "tmux 3.2 installed",
		});
	});

	it("should return pass for exact minimum version (3.0)", async () => {
		mockExecFileResult("tmux 3.0\n");
		const result = await checkTmux();
		expect(result.status).toBe("pass");
		expect(result.message).toBe("tmux 3.0 installed");
	});

	it("should return pass for development build format (next-3.3)", async () => {
		mockExecFileResult("tmux next-3.3\n");
		const result = await checkTmux();
		expect(result.status).toBe("pass");
		expect(result.message).toBe("tmux 3.3 installed");
	});

	it("should return pass for major version above minimum", async () => {
		mockExecFileResult("tmux 4.0\n");
		const result = await checkTmux();
		expect(result.status).toBe("pass");
	});

	it("should return fail when tmux is not installed", async () => {
		mockExecFileError(new Error("command not found: tmux"));
		const result = await checkTmux();
		expect(result).toEqual({
			name: "tmux",
			status: "fail",
			message: "tmux is not installed",
			details: "Install tmux: brew install tmux (macOS) or sudo apt install tmux (Ubuntu).",
		});
	});

	it("should return fail when version is below minimum (2.9)", async () => {
		mockExecFileResult("tmux 2.9\n");
		const result = await checkTmux();
		expect(result.status).toBe("fail");
		expect(result.message).toContain("2.9");
		expect(result.message).toContain("below minimum");
	});

	it("should return fail for very old version (1.8)", async () => {
		mockExecFileResult("tmux 1.8\n");
		const result = await checkTmux();
		expect(result.status).toBe("fail");
	});

	it("should return warning when version output is unparseable", async () => {
		mockExecFileResult("something unexpected");
		const result = await checkTmux();
		expect(result.status).toBe("warning");
		expect(result.message).toContain("Could not parse");
		expect(result.message).toContain("something unexpected");
	});

	it("should return warning for empty version output", async () => {
		mockExecFileResult("");
		const result = await checkTmux();
		expect(result.status).toBe("warning");
	});

	it("should always set name to tmux", async () => {
		mockExecFileResult("tmux 3.4\n");
		const result = await checkTmux();
		expect(result.name).toBe("tmux");
	});
});
