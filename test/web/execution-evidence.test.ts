import { describe, expect, it } from "vitest";
import {
	buildExecutionCardMarkup,
	clampExecutionPanelWidth,
	getExecutionPanelWidthBounds,
	mergeExecutionEventSnapshot,
	renderAnsiToHtml,
	shouldHideExecutionPanel,
} from "../../web/app.js";

describe("execution evidence helpers", () => {
	it("merges execution events by preserving later evidence", () => {
		const planned = mergeExecutionEventSnapshot(undefined, {
			runId: "run-1",
			toolName: "send_to_agent",
			phase: "planned",
			summary: "Prompting agent",
			createdAt: 1,
		});
		const settled = mergeExecutionEventSnapshot(planned, {
			runId: "run-1",
			toolName: "send_to_agent",
			phase: "settled",
			workspace: {
				workingDir: "/tmp/demo",
				available: true,
				changedFiles: ["src/main.ts"],
				diffSummary: ["src/main.ts | 5 +++++"],
			},
			createdAt: 2,
		});

		expect(settled.summary).toBe("Prompting agent");
		expect(settled.phase).toBe("settled");
		expect(settled.workspace.changedFiles).toEqual(["src/main.ts"]);
	});

	it("renders ANSI content into styled HTML spans", () => {
		const html = renderAnsiToHtml("\u001b[31mfailed\u001b[0m");
		expect(html).toContain("span");
		expect(html).toContain("failed");
		expect(html).toContain("color:#ef5350");
	});

	it("builds execution card markup with workspace and persistence evidence", () => {
		const markup = buildExecutionCardMarkup({
			runId: "run-1",
			toolName: "memory_write",
			phase: "persisted",
			summary: "Wrote memory/core.md",
			workspace: {
				workingDir: "/tmp/demo",
				available: true,
				changedFiles: ["memory/core.md"],
				diffStat: "1 file changed, 2 insertions(+)",
				diffSummary: ["memory/core.md | 2 ++"],
			},
			persistence: {
				memoryWrites: ["memory/core.md"],
				conversationPersisted: true,
			},
			test: {
				status: "not_run",
				summary: "No test or build command detected",
			},
			verification: {
				status: "unverified",
				summary: "No verification command detected in the available evidence",
			},
		});

		expect(markup).toContain("memory_write");
		expect(markup).toContain("memory/core.md");
		expect(markup).toContain("Diff 统计");
		expect(markup).toContain("对话会持久化");
	});

	it("builds collapsed execution card markup with title only", () => {
		const markup = buildExecutionCardMarkup(
			{
				runId: "run-2",
				toolName: "send_to_agent",
				phase: "planned",
				summary: "Prompting agent",
				workspace: {
					workingDir: "/tmp/demo",
					available: true,
					changedFiles: ["src/main.ts"],
					diffSummary: ["src/main.ts | 5 +++++"],
				},
			},
			true,
		);

		expect(markup).toContain("send_to_agent");
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).not.toContain("Prompting agent");
		expect(markup).not.toContain("目标目录");
		expect(markup).not.toContain("改动文件");
	});

	it("clamps execution panel width within min/max bounds", () => {
		expect(clampExecutionPanelWidth(200, 320, 640)).toBe(320);
		expect(clampExecutionPanelWidth(480, 320, 640)).toBe(480);
		expect(clampExecutionPanelWidth(900, 320, 640)).toBe(640);
	});

	it("limits floating execution panel max width to half of container", () => {
		expect(getExecutionPanelWidthBounds(1200)).toEqual({ minWidth: 320, maxWidth: 600 });
		expect(getExecutionPanelWidthBounds(500)).toEqual({ minWidth: 320, maxWidth: 320 });
	});

	it("hides floating panel after dragging width under threshold", () => {
		expect(shouldHideExecutionPanel(179)).toBe(true);
		expect(shouldHideExecutionPanel(180)).toBe(true);
		expect(shouldHideExecutionPanel(181)).toBe(false);
	});
});
