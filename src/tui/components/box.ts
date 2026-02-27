import type { Component } from "./renderer.js";

export interface BoxOptions {
	title?: string;
	borderStyle?: "single" | "double" | "rounded";
	titleStyleFn?: (s: string) => string;
	borderStyleFn?: (s: string) => string;
}

const BORDER = {
	single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
	double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
	rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
};

export class BoxComponent implements Component {
	private children: Component[] = [];
	private options: BoxOptions;
	private cached: string[] | null = null;

	constructor(options: BoxOptions = {}) {
		this.options = { borderStyle: "rounded", ...options };
	}

	addChild(component: Component): void {
		this.children.push(component);
		this.cached = null;
	}

	removeChild(component: Component): void {
		const idx = this.children.indexOf(component);
		if (idx >= 0) {
			this.children.splice(idx, 1);
			this.cached = null;
		}
	}

	clear(): void {
		this.children = [];
		this.cached = null;
	}

	setTitle(title: string): void {
		this.options.title = title;
		this.cached = null;
	}

	render(width: number): string[] {
		if (this.cached) return this.cached;

		const b = BORDER[this.options.borderStyle || "rounded"];
		const bs = this.options.borderStyleFn || ((s: string) => s);
		const ts = this.options.titleStyleFn || ((s: string) => s);
		const innerWidth = width - 2;

		if (innerWidth <= 0) {
			this.cached = [];
			return this.cached;
		}

		const lines: string[] = [];

		// Top border with optional title
		if (this.options.title) {
			const titleText = ` ${this.options.title} `;
			const titleLen = titleText.length;
			const remainingWidth = Math.max(0, innerWidth - titleLen);
			lines.push(bs(b.tl) + bs(b.h) + ts(titleText) + bs(b.h.repeat(Math.max(0, remainingWidth - 1))) + bs(b.tr));
		} else {
			lines.push(bs(b.tl) + bs(b.h.repeat(innerWidth)) + bs(b.tr));
		}

		// Children content
		for (const child of this.children) {
			const childLines = child.render(innerWidth);
			for (const line of childLines) {
				const padded = line + " ".repeat(Math.max(0, innerWidth - stripAnsi(line).length));
				lines.push(bs(b.v) + padded + bs(b.v));
			}
		}

		// Bottom border
		lines.push(bs(b.bl) + bs(b.h.repeat(innerWidth)) + bs(b.br));

		this.cached = lines;
		return lines;
	}

	invalidate(): void {
		this.cached = null;
		for (const child of this.children) {
			child.invalidate();
		}
	}
}

/** Strip ANSI escape codes for width calculation */
function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}
