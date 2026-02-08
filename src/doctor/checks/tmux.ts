import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CheckResult } from "../types.js";

const execFileAsync = promisify(execFile);

const CHECK_NAME = "tmux";
const MIN_MAJOR = 3;
const MIN_MINOR = 0;

/**
 * Checks that tmux is installed and meets the minimum version requirement (3.0).
 *
 * Runs `tmux -V` and parses the output to extract the version number.
 * Handles standard releases (`tmux 3.2a`), development builds
 * (`tmux next-3.3`), and bare versions (`tmux 3.0`).
 */
export async function checkTmux(): Promise<CheckResult> {
	let stdout: string;
	try {
		const result = await execFileAsync("tmux", ["-V"], { timeout: 5000 });
		stdout = result.stdout.trim();
	} catch {
		return {
			name: CHECK_NAME,
			status: "fail",
			message: "tmux is not installed",
			details: "Install tmux: brew install tmux (macOS) or sudo apt install tmux (Ubuntu).",
		};
	}

	// Extract version digits from formats like "tmux 3.2a", "tmux next-3.3", "tmux 3.0"
	const match = stdout.match(/(\d+)\.(\d+)/);
	if (!match) {
		return {
			name: CHECK_NAME,
			status: "warning",
			message: `Could not parse tmux version from: ${stdout}`,
			details: `Minimum required version is ${MIN_MAJOR}.${MIN_MINOR}.`,
		};
	}

	const major = Number(match[1]);
	const minor = Number(match[2]);

	if (major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR)) {
		return {
			name: CHECK_NAME,
			status: "pass",
			message: `tmux ${major}.${minor} installed`,
		};
	}

	return {
		name: CHECK_NAME,
		status: "fail",
		message: `tmux ${major}.${minor} is below minimum required version ${MIN_MAJOR}.${MIN_MINOR}`,
		details: "Upgrade tmux: brew upgrade tmux (macOS) or sudo apt upgrade tmux (Ubuntu).",
	};
}
