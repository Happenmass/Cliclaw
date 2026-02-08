import type { Component } from "./renderer.js";

export class ContainerComponent implements Component {
	private children: Component[] = [];
	private cached: string[] | null = null;

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

	getChildren(): Component[] {
		return this.children;
	}

	clear(): void {
		this.children = [];
		this.cached = null;
	}

	render(width: number): string[] {
		if (this.cached) return this.cached;

		const lines: string[] = [];
		for (const child of this.children) {
			lines.push(...child.render(width));
		}

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
