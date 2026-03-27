/**
 * Root cause analysis: prove exactly what the OLD sendResponse code did
 * when called with value="2" on a pane containing Claude Code's numbered permission menu.
 *
 * OLD priority chain (before this fix):
 *   P1: "Enter" exact match
 *   P2: "Escape" exact match
 *   P3: "arrow:" prefix
 *   P4: "keys:" prefix
 *   P5: capturePane → regex /Allow/i → send 'y' + Enter   ← THE SUSPECT
 *   P6: fallback sendText(value) + Enter
 */
import { describe, it, expect, vi } from "vitest";

/**
 * Simulate the OLD sendResponse logic exactly as it was before any changes.
 * Extracted from git HEAD (commit d8aaaf5) for claude-code.ts lines 53-108.
 */
async function oldSendResponse(
	bridge: {
		sendKeys: ReturnType<typeof vi.fn>;
		sendText: ReturnType<typeof vi.fn>;
		sendEnter: ReturnType<typeof vi.fn>;
		sendEscape: ReturnType<typeof vi.fn>;
		capturePane: ReturnType<typeof vi.fn>;
	},
	paneTarget: string,
	response: string,
): Promise<void> {
	// Priority 1
	if (response === "Enter") {
		await bridge.sendEnter(paneTarget);
		return;
	}
	// Priority 2
	if (response === "Escape") {
		await bridge.sendEscape(paneTarget);
		return;
	}
	// Priority 3
	if (response.startsWith("arrow:")) {
		const parts = response.split(":");
		const direction = parts[1] === "up" ? "Up" : "Down";
		const times = parseInt(parts[2] || "1", 10);
		for (let i = 0; i < times; i++) {
			await bridge.sendKeys(paneTarget, direction);
		}
		await bridge.sendEnter(paneTarget);
		return;
	}
	// Priority 4
	if (response.startsWith("keys:")) {
		const keyNames = response.slice(5).split(",");
		for (const key of keyNames) {
			const trimmed = key.trim();
			if (!trimmed) continue;
			// simplified sendNamedKey
			await bridge.sendKeys(paneTarget, trimmed);
		}
		return;
	}
	// Priority 5: THE y/n AUTO-CONFIRM — this is the old code exactly
	const capture = await bridge.capturePane(paneTarget, { startLine: -5 });
	const lastLines = capture.content;
	if (/\(y\/n\)/i.test(lastLines) || /Allow/i.test(lastLines) || /approve/i.test(lastLines)) {
		await bridge.sendKeys(paneTarget, "y", { literal: true });
		await bridge.sendEnter(paneTarget);
		return;
	}
	// Priority 6: fallback
	await bridge.sendText(paneTarget, response);
	await bridge.sendEnter(paneTarget);
}

describe("ROOT CAUSE PROOF: old sendResponse behavior", () => {
	function createMockBridge(paneContent: string) {
		return {
			sendKeys: vi.fn().mockResolvedValue(undefined),
			sendText: vi.fn().mockResolvedValue(undefined),
			sendEnter: vi.fn().mockResolvedValue(undefined),
			sendEscape: vi.fn().mockResolvedValue(undefined),
			capturePane: vi.fn().mockResolvedValue({
				content: paneContent,
				lines: paneContent.split("\n"),
				timestamp: Date.now(),
			}),
		};
	}

	it("PROOF: old code sends 'y'+Enter (NOT '2') when pane contains 'Allow'", async () => {
		// This is the exact pane content from Claude Code's permission menu
		const paneContent = [
			"  Allow tool?",
			"❯ 1. Yes",
			"  2. Yes, allow all edits during this session (shift+tab)",
			"  3. No",
		].join("\n");

		const bridge = createMockBridge(paneContent);
		await oldSendResponse(bridge, "test:0.0", "2");

		// ACTUAL behavior: the "Allow" regex in Priority 5 matches first
		// So it sends 'y' + Enter, completely ignoring the requested value "2"
		expect(bridge.sendKeys).toHaveBeenCalledWith("test:0.0", "y", { literal: true });
		expect(bridge.sendEnter).toHaveBeenCalledTimes(1);

		// The value "2" was NEVER sent to the pane
		expect(bridge.sendText).not.toHaveBeenCalled();
	});

	it("PROOF: old code would send '2'+Enter if pane did NOT contain 'Allow'", async () => {
		// A menu without "Allow" — no y/n auto-confirm triggers
		const paneContent = [
			"  Choose an option:",
			"❯ 1. Option A",
			"  2. Option B",
			"  3. Option C",
		].join("\n");

		const bridge = createMockBridge(paneContent);
		await oldSendResponse(bridge, "test:0.0", "2");

		// Without "Allow" match, falls to Priority 6: sendText('2') + Enter
		expect(bridge.sendText).toHaveBeenCalledWith("test:0.0", "2");
		expect(bridge.sendEnter).toHaveBeenCalledTimes(1);
		// 'y' was NOT sent
		expect(bridge.sendKeys).not.toHaveBeenCalled();
	});

	it("PROOF: the regex /Allow/i is overly broad — matches numbered menu header", async () => {
		// The regex matches because the menu HEADER says "Allow tool?"
		// This is NOT a y/n prompt — it's a numbered selection menu
		const text = "  Allow tool?\n❯ 1. Yes\n  2. Yes, allow all\n  3. No";
		expect(/Allow/i.test(text)).toBe(true);

		// But there is no (y/n) pattern
		expect(/\(y\/n\)/i.test(text)).toBe(false);
	});
});
