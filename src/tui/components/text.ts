import type { Component } from "./renderer.js";

export class TextComponent implements Component {
	private text: string;
	private cached: string[] | null = null;
	private styleFn: ((s: string) => string) | null;

	constructor(text = "", styleFn?: (s: string) => string) {
		this.text = text;
		this.styleFn = styleFn || null;
	}

	setText(text: string): void {
		if (this.text !== text) {
			this.text = text;
			this.cached = null;
		}
	}

	getText(): string {
		return this.text;
	}

	render(width: number): string[] {
		if (this.cached) return this.cached;

		const lines = this.text.split("\n").map((line) => {
			const trimmed = line.substring(0, width);
			return this.styleFn ? this.styleFn(trimmed) : trimmed;
		});

		this.cached = lines;
		return lines;
	}

	invalidate(): void {
		this.cached = null;
	}
}
