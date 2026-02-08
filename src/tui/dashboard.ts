import chalk from "chalk";
import type { Component } from "./components/renderer.js";
import { BoxComponent } from "./components/box.js";
import { TextComponent } from "./components/text.js";
import { ProgressComponent } from "./components/progress.js";
import { TaskListComponent } from "./task-list.js";
import { LogStreamComponent } from "./log-stream.js";
import { AgentPreviewComponent } from "./agent-preview.js";
import type { Task, TaskProgress } from "../core/task.js";

export class Dashboard implements Component {
	// Sub-components
	private headerText: TextComponent;
	private progressBar: ProgressComponent;
	private taskList: TaskListComponent;
	private agentPreview: AgentPreviewComponent;
	private logStream: LogStreamComponent;
	private statusBar: TextComponent;

	// Boxes
	private taskBox: BoxComponent;
	private previewBox: BoxComponent;
	private logBox: BoxComponent;

	private goal = "";
	private startTime = Date.now();
	private cached: string[] | null = null;

	constructor() {
		this.headerText = new TextComponent("", chalk.bold);
		this.progressBar = new ProgressComponent({
			fillStyleFn: chalk.green,
			emptyStyleFn: chalk.dim,
		});

		this.taskList = new TaskListComponent();
		this.taskBox = new BoxComponent({
			title: "Tasks",
			borderStyleFn: chalk.dim,
			titleStyleFn: chalk.bold,
		});
		this.taskBox.addChild(this.taskList);

		this.agentPreview = new AgentPreviewComponent(6);
		this.previewBox = new BoxComponent({
			title: "Agent Output",
			borderStyleFn: chalk.dim,
			titleStyleFn: chalk.bold,
		});
		this.previewBox.addChild(this.agentPreview);

		this.logStream = new LogStreamComponent({ maxLines: 8 });
		this.logBox = new BoxComponent({
			title: "Log",
			borderStyleFn: chalk.dim,
			titleStyleFn: chalk.bold,
		});
		this.logBox.addChild(this.logStream);

		this.statusBar = new TextComponent(
			" [q] Quit  [p] Pause  [c] Config  [s] Steer  [Tab] View Agent",
			chalk.bgWhite.black,
		);
	}

	setGoal(goal: string): void {
		this.goal = goal;
		this.cached = null;
	}

	setTasks(tasks: Task[]): void {
		this.taskList.setTasks(tasks);
		this.cached = null;
	}

	setProgress(progress: TaskProgress): void {
		this.progressBar.setProgress(
			progress.completed + progress.failed + progress.skipped,
			progress.total,
			`${progress.completed}/${progress.total} tasks`,
		);
		this.cached = null;
	}

	setAgentOutput(content: string): void {
		this.agentPreview.setContent(content);
		this.cached = null;
	}

	addLog(message: string, level?: "info" | "warn" | "error"): void {
		this.logStream.addMessage(message, level);
		this.cached = null;
	}

	setStatusText(text: string): void {
		this.statusBar.setText(text);
		this.cached = null;
	}

	render(width: number): string[] {
		// Update header with elapsed time
		const elapsed = formatDuration(Date.now() - this.startTime);
		const header = `  ${chalk.bold("CLIPilot")} ${chalk.dim("|")} ${this.goal} ${chalk.dim("|")} ${chalk.dim("⏱")} ${elapsed}`;
		this.headerText.setText(header);

		const lines: string[] = [];

		// Header
		lines.push("");
		lines.push(...this.headerText.render(width));
		lines.push("");

		// Progress bar
		lines.push("  " + this.progressBar.render(width - 4)[0]);
		lines.push("");

		// Tasks
		lines.push(...this.taskBox.render(width));

		// Agent Preview
		lines.push(...this.previewBox.render(width));

		// Log
		lines.push(...this.logBox.render(width));

		// Status bar (at bottom)
		lines.push(...this.statusBar.render(width));

		this.cached = lines;
		return lines;
	}

	invalidate(): void {
		this.cached = null;
		this.headerText.invalidate();
		this.progressBar.invalidate();
		this.taskList.invalidate();
		this.agentPreview.invalidate();
		this.logStream.invalidate();
		this.statusBar.invalidate();
		this.taskBox.invalidate();
		this.previewBox.invalidate();
		this.logBox.invalidate();
	}
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}:${pad(minutes)}:${pad(seconds)}`;
	}
	return `${pad(minutes)}:${pad(seconds)}`;
}

function pad(n: number): string {
	return n.toString().padStart(2, "0");
}
