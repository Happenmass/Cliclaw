import chalk from "chalk";
import type { Component } from "./components/renderer.js";

export class AgentPreviewComponent implements Component {
	private lines: string[] = [];
	private maxLines: number;
	private cached: string[] | null = null;

	constructor(maxLines = 8) {
		this.maxLines = maxLines;
	}

	setContent(content: string): void {
		this.lines = content.split("\n").slice(-this.maxLines);
		this.cached = null;
	}

	setMaxLines(n: number): void {
		this.maxLines = n;
		this.cached = null;
	}

	render(width: number): string[] {
		if (this.cached) return this.cached;

		const result: string[] = [];

		if (this.lines.length === 0) {
			result.push("  " + chalk.dim("(no agent output)"));
		} else {
			for (const line of this.lines) {
				result.push("  " + chalk.dim(line.substring(0, width - 2)));
			}
		}

		// Pad to maxLines
		while (result.length < this.maxLines) {
			result.push("");
		}

		this.cached = result;
		return result;
	}

	invalidate(): void {
		this.cached = null;
	}
}
