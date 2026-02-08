import type { TmuxBridge } from "../tmux/bridge.js";
import { logger } from "../utils/logger.js";
import type { AgentAdapter, AgentCharacteristics, LaunchOptions } from "./adapter.js";

export class ClaudeCodeAdapter implements AgentAdapter {
	readonly name = "claude-code";
	readonly displayName = "Claude Code";

	private command: string;

	constructor(opts?: { command?: string }) {
		this.command = opts?.command || "claude";
	}

	async launch(bridge: TmuxBridge, opts: LaunchOptions): Promise<string> {
		// Create session with a single window (no extra windows)
		const hasSession = await bridge.hasSession(opts.sessionName);
		if (!hasSession) {
			await bridge.createSession(opts.sessionName, { cwd: opts.workingDir });
		}

		// Use the default window (index 0) of the session
		const paneTarget = `${opts.sessionName}:0.0`;

		// Type "claude" and press Enter to launch
		logger.info("claude-code", `Launching in ${paneTarget}`);
		await bridge.sendText(paneTarget, this.command);
		await sleep(200);
		await bridge.sendEnter(paneTarget);

		// Wait a fixed 5 seconds for Claude Code to initialize
		logger.info("claude-code", "Waiting 5s for agent to initialize...");
		await sleep(5000);

		return paneTarget;
	}

	async sendPrompt(bridge: TmuxBridge, paneTarget: string, prompt: string): Promise<void> {
		logger.info("claude-code", `Sending prompt (${prompt.length} chars)`);

		// Send the prompt text first
		await bridge.sendText(paneTarget, prompt);

		// Wait 0.2s before pressing Enter (text and Enter must be separate)
		await sleep(200);

		// Press Enter to submit
		await bridge.sendEnter(paneTarget);
	}

	async sendResponse(bridge: TmuxBridge, paneTarget: string, response: string): Promise<void> {
		logger.info("claude-code", `Sending response: ${response}`);

		// Detect what kind of prompt we're responding to
		const capture = await bridge.capturePane(paneTarget, { startLine: -5 });
		const lastLines = capture.content;

		if (/\(y\/n\)/i.test(lastLines) || /Allow/i.test(lastLines) || /approve/i.test(lastLines)) {
			// Yes/no prompt — send 'y'
			await bridge.sendKeys(paneTarget, "y", { literal: true });
			await sleep(200);
			await bridge.sendEnter(paneTarget);
		} else if (response.startsWith("arrow:")) {
			// Arrow key selection: "arrow:down:2" means press Down 2 times then Enter
			const parts = response.split(":");
			const direction = parts[1] === "up" ? "Up" : "Down";
			const times = parseInt(parts[2] || "1", 10);
			for (let i = 0; i < times; i++) {
				await bridge.sendKeys(paneTarget, direction);
				await sleep(100);
			}
			await sleep(200);
			await bridge.sendEnter(paneTarget);
		} else {
			// General input — send the response text, wait 0.2s, then Enter
			await bridge.sendText(paneTarget, response);
			await sleep(200);
			await bridge.sendEnter(paneTarget);
		}
	}

	async shutdown(bridge: TmuxBridge, paneTarget: string): Promise<void> {
		logger.info("claude-code", "Shutting down agent");
		await bridge.sendText(paneTarget, "/exit");
		await sleep(200);
		await bridge.sendEnter(paneTarget);
		await sleep(1000);
	}

	async abort(bridge: TmuxBridge, paneTarget: string): Promise<void> {
		logger.info("claude-code", "Aborting current operation");
		await bridge.sendEscape(paneTarget);
		await sleep(200);
		// Double escape to ensure we're back to input
		await bridge.sendEscape(paneTarget);
	}

	getCharacteristics(): AgentCharacteristics {
		return {
			waitingPatterns: [
				/^>\s*$/m, // Empty prompt
				/\(y\/n\)/i, // Yes/no prompt
				/Allow/i, // Permission prompt
				/\?.*:?\s*$/m, // Question prompt
			],
			completionPatterns: [
				/^>\s*$/m, // Back to empty prompt after output
			],
			errorPatterns: [
				/Error:/i,
				/Failed/i,
				/ENOENT/,
				/EACCES/,
				/Connection refused/i,
				/Timeout/i,
				/command not found/,
			],
			activePatterns: [
				/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, // Spinner
				/\.\.\.\s*$/m, // Thinking dots
				/Reading|Writing|Editing|Running/i, // Action words
			],
			confirmKey: "y",
			abortKey: "Escape",
		};
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
