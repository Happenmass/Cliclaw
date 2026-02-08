import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TmuxBridge } from "../../src/tmux/bridge.js";

const bridge = new TmuxBridge();
const TEST_SESSION = "clipilot-test-" + Date.now();

describe("TmuxBridge", () => {
	let tmuxAvailable = false;

	beforeAll(async () => {
		tmuxAvailable = await bridge.checkInstalled();
	});

	afterAll(async () => {
		if (tmuxAvailable) {
			try {
				await bridge.killSession(TEST_SESSION);
			} catch {
				// Already killed or never created
			}
		}
	});

	it("should check if tmux is installed", async () => {
		const installed = await bridge.checkInstalled();
		expect(typeof installed).toBe("boolean");
	});

	it("should get tmux version", async () => {
		if (!tmuxAvailable) return;
		const version = await bridge.getVersion();
		expect(version).toMatch(/tmux/i);
	});

	it("should create and destroy sessions", async () => {
		if (!tmuxAvailable) return;

		await bridge.createSession(TEST_SESSION);
		const has = await bridge.hasSession(TEST_SESSION);
		expect(has).toBe(true);

		const sessions = await bridge.listSessions();
		expect(sessions.some((s) => s.name === TEST_SESSION)).toBe(true);

		await bridge.killSession(TEST_SESSION);
		const hasAfter = await bridge.hasSession(TEST_SESSION);
		expect(hasAfter).toBe(false);
	});

	it("should send keys and capture pane", async () => {
		if (!tmuxAvailable) return;

		await bridge.createSession(TEST_SESSION);
		const target = `${TEST_SESSION}:0.0`;

		// Send a command
		await bridge.sendKeys(target, "echo hello-clipilot-test", { literal: true });
		await bridge.sendEnter(target);

		// Wait for command to execute
		await new Promise((r) => setTimeout(r, 500));

		// Capture output
		const capture = await bridge.capturePane(target);
		expect(capture.content).toContain("hello-clipilot-test");
		expect(capture.lines.length).toBeGreaterThan(0);
		expect(capture.timestamp).toBeGreaterThan(0);

		await bridge.killSession(TEST_SESSION);
	});

	it("should build target strings correctly", () => {
		expect(TmuxBridge.target("sess")).toBe("sess");
		expect(TmuxBridge.target("sess", 0)).toBe("sess:0");
		expect(TmuxBridge.target("sess", 1, 2)).toBe("sess:1.2");
	});

	it("should list windows", async () => {
		if (!tmuxAvailable) return;

		await bridge.createSession(TEST_SESSION);
		const windows = await bridge.listWindows(TEST_SESSION);
		expect(windows.length).toBeGreaterThanOrEqual(1);
		expect(windows[0].index).toBe(0);

		await bridge.killSession(TEST_SESSION);
	});

	it("should list panes", async () => {
		if (!tmuxAvailable) return;

		await bridge.createSession(TEST_SESSION);
		const panes = await bridge.listPanes(TEST_SESSION);
		expect(panes.length).toBeGreaterThanOrEqual(1);
		expect(panes[0].width).toBeGreaterThan(0);
		expect(panes[0].height).toBeGreaterThan(0);

		await bridge.killSession(TEST_SESSION);
	});
});
