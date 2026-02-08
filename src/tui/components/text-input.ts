import chalk from "chalk";
import type { Component } from "./renderer.js";

export interface TextInputOptions {
	placeholder?: string;
	mask?: boolean;
	initialValue?: string;
	onSubmit?: (value: string) => void;
	onCancel?: () => void;
}

export class TextInputComponent implements Component {
	private value: string;
	private placeholder: string;
	private mask: boolean;
	private onSubmit: ((value: string) => void) | null;
	private onCancel: (() => void) | null;
	private cached: string[] | null = null;

	constructor(options: TextInputOptions = {}) {
		this.value = options.initialValue ?? "";
		this.placeholder = options.placeholder ?? "";
		this.mask = options.mask ?? false;
		this.onSubmit = options.onSubmit ?? null;
		this.onCancel = options.onCancel ?? null;
	}

	getValue(): string {
		return this.value;
	}

	handleInput(data: string): void {
		if (data === "\r") {
			// Enter — submit
			this.onSubmit?.(this.value);
			return;
		}

		if (data === "\x1b" || data.startsWith("\x1b[")) {
			// Esc — cancel; arrow keys and other escape sequences — ignore
			if (data === "\x1b") {
				this.onCancel?.();
			}
			return;
		}

		if (data === "\x7f" || data === "\b") {
			// Backspace
			if (this.value.length > 0) {
				this.value = this.value.slice(0, -1);
				this.cached = null;
			}
			return;
		}

		// Regular character input (supports paste — multi-char data)
		let changed = false;
		for (const ch of data) {
			if (ch >= " " && ch !== "\x7f") {
				this.value += ch;
				changed = true;
			}
		}
		if (changed) {
			this.cached = null;
		}
	}

	render(width: number): string[] {
		if (this.cached) return this.cached;

		let display: string;
		if (this.value.length === 0) {
			display = chalk.dim(this.placeholder) + chalk.inverse(" ");
		} else {
			const shown = this.mask ? "*".repeat(this.value.length) : this.value;
			display = shown + chalk.inverse(" ");
		}

		const lines = [" > " + display];
		this.cached = lines;
		return lines;
	}

	invalidate(): void {
		this.cached = null;
	}
}
