import chalk from "chalk";
import type { Component } from "./components/renderer.js";

export interface LogEntry {
	timestamp: number;
	message: string;
	level?: "info" | "warn" | "error";
}

export class LogStreamComponent implements Component {
	private entries: LogEntry[] = [];
	private maxEntries: number;
	private maxLines: number;
	private cached: string[] | null = null;

	constructor(opts?: { maxEntries?: number; maxLines?: number }) {
		this.maxEntries = opts?.maxEntries || 100;
		this.maxLines = opts?.maxLines || 10;
	}

	addEntry(entry: LogEntry): void {
		this.entries.push(entry);
		if (this.entries.length > this.maxEntries) {
			this.entries.shift();
		}
		this.cached = null;
	}

	addMessage(message: string, level?: "info" | "warn" | "error"): void {
		this.addEntry({ timestamp: Date.now(), message, level });
	}

	clear(): void {
		this.entries = [];
		this.cached = null;
	}

	render(width: number): string[] {
		if (this.cached) return this.cached;

		const visible = this.entries.slice(-this.maxLines);
		const lines: string[] = [];

		for (const entry of visible) {
			const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
				hour12: false,
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});

			const timeStr = chalk.dim(`[${time}]`);
			let msg = entry.message;

			if (entry.level === "error") {
				msg = chalk.red(msg);
			} else if (entry.level === "warn") {
				msg = chalk.yellow(msg);
			}

			const line = `  ${timeStr} ${msg}`;
			lines.push(line.substring(0, width));
		}

		// Pad with empty lines if fewer entries than maxLines
		while (lines.length < this.maxLines) {
			lines.unshift("  " + chalk.dim("·"));
		}

		this.cached = lines;
		return lines;
	}

	invalidate(): void {
		this.cached = null;
	}
}
