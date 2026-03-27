import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeCodeAdapter } from "../../src/agents/claude-code.js";
import type { TmuxBridge } from "../../src/tmux/bridge.js";

function createMockBridge(paneContent = "> "): TmuxBridge {
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
	} as any;
}

describe("ClaudeCodeAdapter.sendResponse", () => {
	let adapter: ClaudeCodeAdapter;
	let bridge: TmuxBridge;
	const pane = "test:0.0";

	beforeEach(() => {
		adapter = new ClaudeCodeAdapter();
		bridge = createMockBridge();
	});

	it('should only press Enter for "Enter" response', async () => {
		await adapter.sendResponse(bridge, pane, "Enter");

		expect(bridge.sendEnter).toHaveBeenCalledTimes(1);
		expect(bridge.sendEnter).toHaveBeenCalledWith(pane);
		expect(bridge.sendText).not.toHaveBeenCalled();
		expect(bridge.sendKeys).not.toHaveBeenCalled();
	});

	it('should only press Escape for "Escape" response', async () => {
		await adapter.sendResponse(bridge, pane, "Escape");

		expect(bridge.sendEscape).toHaveBeenCalledTimes(1);
		expect(bridge.sendEscape).toHaveBeenCalledWith(pane);
		expect(bridge.sendText).not.toHaveBeenCalled();
		expect(bridge.sendEnter).not.toHaveBeenCalled();
	});

	it("should send arrow keys then Enter for arrow: format", async () => {
		await adapter.sendResponse(bridge, pane, "arrow:down:2");

		// 2 Down keys + 1 Enter
		expect(bridge.sendKeys).toHaveBeenCalledTimes(2);
		expect(bridge.sendKeys).toHaveBeenNthCalledWith(1, pane, "Down");
		expect(bridge.sendKeys).toHaveBeenNthCalledWith(2, pane, "Down");
		expect(bridge.sendEnter).toHaveBeenCalledTimes(1);
	});

	it("should send generic key sequence for keys: format", async () => {
		await adapter.sendResponse(bridge, pane, "keys:Down,Down,Enter");

		expect(bridge.sendKeys).toHaveBeenCalledTimes(3);
		expect(bridge.sendKeys).toHaveBeenNthCalledWith(1, pane, "Down");
		expect(bridge.sendKeys).toHaveBeenNthCalledWith(2, pane, "Down");
		expect(bridge.sendKeys).toHaveBeenNthCalledWith(3, pane, "Enter");
	});

	it("should send single character as literal in keys: format", async () => {
		await adapter.sendResponse(bridge, pane, "keys:1,Enter");

		expect(bridge.sendKeys).toHaveBeenCalledTimes(2);
		// Single char "1" should be sent as literal
		expect(bridge.sendKeys).toHaveBeenNthCalledWith(1, pane, "1", { literal: true });
		expect(bridge.sendKeys).toHaveBeenNthCalledWith(2, pane, "Enter");
	});

	it("should detect (y/n) context and send y", async () => {
		bridge = createMockBridge("Do you want to proceed? (y/n)");

		await adapter.sendResponse(bridge, pane, "some text");

		expect(bridge.sendKeys).toHaveBeenCalledWith(pane, "y", { literal: true });
		expect(bridge.sendEnter).toHaveBeenCalledTimes(1);
	});

	it("should auto-confirm plain 'Allow' prompt without numbered menu", async () => {
		bridge = createMockBridge("Allow this action?");

		await adapter.sendResponse(bridge, pane, "some text");

		expect(bridge.sendKeys).toHaveBeenCalledWith(pane, "y", { literal: true });
		expect(bridge.sendEnter).toHaveBeenCalledTimes(1);
	});

	it("should NOT auto-confirm when numbered menu is present (even with 'Allow' in pane)", async () => {
		// This is the actual Claude Code permission menu — contains "Allow" but is a numbered menu
		bridge = createMockBridge(
			[
				"  Allow tool?",
				"❯ 1. Yes",
				"  2. Yes, allow all edits during this session (shift+tab)",
				"  3. No",
			].join("\n"),
		);

		await adapter.sendResponse(bridge, pane, "2");

		// Should fall through to text input: sendText('2') + Enter
		expect(bridge.sendText).toHaveBeenCalledWith(pane, "2");
		expect(bridge.sendEnter).toHaveBeenCalledTimes(1);
		// Should NOT have sent 'y'
		const sendKeysCalls = (bridge.sendKeys as any).mock.calls;
		const yCalls = sendKeysCalls.filter((c: any[]) => c[1] === "y");
		expect(yCalls).toHaveLength(0);
	});

	it("should pass through option '1' as text on numbered menu", async () => {
		bridge = createMockBridge(
			["❯ 1. Yes", "  2. No", "  3. Cancel"].join("\n"),
		);

		await adapter.sendResponse(bridge, pane, "1");

		expect(bridge.sendText).toHaveBeenCalledWith(pane, "1");
		expect(bridge.sendEnter).toHaveBeenCalledTimes(1);
	});

	it("should send general text + Enter as fallback", async () => {
		await adapter.sendResponse(bridge, pane, "hello world");

		expect(bridge.sendText).toHaveBeenCalledWith(pane, "hello world");
		expect(bridge.sendEnter).toHaveBeenCalledTimes(1);
	});
});
