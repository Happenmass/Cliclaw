import type { Component } from "./renderer.js";

export class ProgressComponent implements Component {
	private value = 0;
	private total = 1;
	private label = "";
	private cached: string[] | null = null;
	private fillStyleFn: (s: string) => string;
	private emptyStyleFn: (s: string) => string;

	constructor(opts?: {
		fillStyleFn?: (s: string) => string;
		emptyStyleFn?: (s: string) => string;
	}) {
		this.fillStyleFn = opts?.fillStyleFn || ((s) => s);
		this.emptyStyleFn = opts?.emptyStyleFn || ((s) => s);
	}

	setProgress(value: number, total: number, label?: string): void {
		this.value = value;
		this.total = total;
		if (label !== undefined) this.label = label;
		this.cached = null;
	}

	render(width: number): string[] {
		if (this.cached) return this.cached;

		const percent = this.total > 0 ? Math.round((this.value / this.total) * 100) : 0;
		const percentStr = ` ${percent}%`;
		const labelStr = this.label ? ` ${this.label}` : "";

		// Bar area = width - brackets - percent - label
		const barWidth = Math.max(5, width - 2 - percentStr.length - labelStr.length);
		const filled = Math.round((this.value / Math.max(1, this.total)) * barWidth);
		const empty = barWidth - filled;

		const bar =
			"[" +
			this.fillStyleFn("█".repeat(filled)) +
			this.emptyStyleFn("░".repeat(empty)) +
			"]" +
			percentStr +
			labelStr;

		this.cached = [bar];
		return this.cached;
	}

	invalidate(): void {
		this.cached = null;
	}
}
