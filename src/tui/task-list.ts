import chalk from "chalk";
import type { Component } from "./components/renderer.js";
import type { Task, TaskStatus } from "../core/task.js";

const STATUS_ICONS: Record<TaskStatus, string> = {
	pending: "○",
	running: "▶",
	completed: "✓",
	failed: "✗",
	skipped: "⊘",
};

const STATUS_COLORS: Record<TaskStatus, (s: string) => string> = {
	pending: chalk.dim,
	running: chalk.blue,
	completed: chalk.green,
	failed: chalk.red,
	skipped: chalk.yellow,
};

export class TaskListComponent implements Component {
	private tasks: Task[] = [];
	private cached: string[] | null = null;

	setTasks(tasks: Task[]): void {
		this.tasks = tasks;
		this.cached = null;
	}

	render(width: number): string[] {
		if (this.cached) return this.cached;

		if (this.tasks.length === 0) {
			this.cached = [chalk.dim("  No tasks")];
			return this.cached;
		}

		const lines: string[] = [];

		for (const task of this.tasks) {
			const icon = STATUS_ICONS[task.status];
			const colorFn = STATUS_COLORS[task.status];
			const agentTag = task.agentType ? chalk.dim(` [${task.agentType}]`) : "";
			const deps = task.dependencies.length > 0 ? chalk.dim(` ← ${task.dependencies.join(",")}`) : "";

			const prefix = `  ${colorFn(icon)} ${chalk.dim(task.id + ".")} `;
			const maxTitleWidth = width - stripAnsi(prefix).length - stripAnsi(agentTag).length - stripAnsi(deps).length;
			const title = task.title.length > maxTitleWidth ? task.title.substring(0, maxTitleWidth - 1) + "…" : task.title;

			let line = prefix;
			if (task.status === "running") {
				line += chalk.bold(title);
			} else {
				line += colorFn(title);
			}
			line += agentTag + deps;

			lines.push(line);
		}

		this.cached = lines;
		return lines;
	}

	invalidate(): void {
		this.cached = null;
	}
}

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}
