import type { TmuxBridge } from "../tmux/bridge.js";
import type { AgentAdapter, AgentCharacteristics, LaunchOptions } from "./adapter.js";
import { logger } from "../utils/logger.js";

export class ClaudeCodeAdapter implements AgentAdapter {
	readonly name = "claude-code";
	readonly displayName = "Claude Code";

	private command: string;

	constructor(opts?: { command?: string }) {
		this.command = opts?.command || "claude";
	}

	async launch(bridge: TmuxBridge, opts: LaunchOptions): Promise<string> {
		const windowName = opts.windowName || "claude-code";

		// Ensure session exists
		const hasSession = await bridge.hasSession(opts.sessionName);
		if (!hasSession) {
			await bridge.createSession(opts.sessionName, { cwd: opts.workingDir });
		}

		// Create a new window for this agent
		const windowIndex = await bridge.createWindow(opts.sessionName, windowName, {
			cwd: opts.workingDir,
		});

		const paneTarget = `${opts.sessionName}:${windowIndex}.0`;

		// Launch Claude Code
		logger.info("claude-code", `Launching in ${paneTarget}`);
		await bridge.runInPane(paneTarget, this.command);

		// Wait for Claude Code to start (look for prompt)
		await this.waitForReady(bridge, paneTarget);

		return paneTarget;
	}

	async sendPrompt(bridge: TmuxBridge, paneTarget: string, prompt: string): Promise<void> {
		logger.info("claude-code", `Sending prompt (${prompt.length} chars)`);

		// Send the prompt text
		await bridge.sendText(paneTarget, prompt);

		// Small delay to ensure text is entered
		await sleep(100);

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
			await bridge.sendEnter(paneTarget);
		} else {
			// General input — send the response text
			await bridge.sendText(paneTarget, response);
			await bridge.sendEnter(paneTarget);
		}
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

	private async waitForReady(bridge: TmuxBridge, paneTarget: string, timeoutMs = 30000): Promise<void> {
		const start = Date.now();

		while (Date.now() - start < timeoutMs) {
			try {
				const capture = await bridge.capturePane(paneTarget, { startLine: -10 });
				const content = capture.content;

				// Claude Code shows a prompt when ready
				if (/>\s*$/m.test(content) || /claude/i.test(content)) {
					logger.info("claude-code", "Agent is ready");
					return;
				}
			} catch {
				// Pane might not be ready yet
			}

			await sleep(1000);
		}

		logger.warn("claude-code", "Timed out waiting for agent to be ready, proceeding anyway");
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
