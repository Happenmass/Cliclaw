export interface Component {
	render(width: number): string[];
	invalidate(): void;
}

export class TUIRenderer {
	private root: Component | null = null;
	private previousLines: string[] = [];
	private width: number;
	private height: number;
	private started = false;
	private renderRequested = false;
	private onInput: ((data: string) => void) | null = null;

	constructor() {
		this.width = process.stdout.columns || 80;
		this.height = process.stdout.rows || 24;
	}

	setRoot(component: Component): void {
		this.root = component;
	}

	setInputHandler(handler: (data: string) => void): void {
		this.onInput = handler;
	}

	start(): void {
		if (this.started) return;
		this.started = true;

		// Enter alternate screen buffer
		process.stdout.write("\x1b[?1049h");
		// Hide cursor
		process.stdout.write("\x1b[?25l");

		// Raw mode for stdin
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
			process.stdin.resume();
			process.stdin.on("data", (data: Buffer) => {
				const str = data.toString();

				// Ctrl+C — always handle
				if (str === "\x03") {
					this.stop();
					process.exit(0);
				}

				this.onInput?.(str);
			});
		}

		// Handle resize
		process.stdout.on("resize", () => {
			this.width = process.stdout.columns || 80;
			this.height = process.stdout.rows || 24;
			this.previousLines = [];
			this.requestRender();
		});

		// Initial render
		this.requestRender();
	}

	stop(): void {
		if (!this.started) return;
		this.started = false;

		// Show cursor
		process.stdout.write("\x1b[?25h");
		// Leave alternate screen buffer
		process.stdout.write("\x1b[?1049l");

		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
	}

	requestRender(): void {
		if (this.renderRequested) return;
		this.renderRequested = true;

		// Use setImmediate to batch multiple invalidations
		setImmediate(() => {
			this.renderRequested = false;
			this.render();
		});
	}

	getWidth(): number {
		return this.width;
	}

	getHeight(): number {
		return this.height;
	}

	private render(): void {
		if (!this.root || !this.started) return;

		const newLines = this.root.render(this.width);

		// Pad/truncate to terminal height
		while (newLines.length < this.height) {
			newLines.push("");
		}
		if (newLines.length > this.height) {
			newLines.length = this.height;
		}

		// Begin synchronized output
		let output = "\x1b[?2026h";

		// Find first changed line
		let firstChanged = -1;
		for (let i = 0; i < newLines.length; i++) {
			if (newLines[i] !== this.previousLines[i]) {
				firstChanged = i;
				break;
			}
		}

		if (firstChanged === -1) {
			// No changes
			process.stdout.write("\x1b[?2026l");
			return;
		}

		// Move cursor to first changed line
		output += `\x1b[${firstChanged + 1};1H`;

		// Clear from cursor to end of screen
		output += "\x1b[J";

		// Write changed lines
		for (let i = firstChanged; i < newLines.length; i++) {
			if (i > firstChanged) {
				output += "\n";
			}
			output += newLines[i];
		}

		// End synchronized output
		output += "\x1b[?2026l";

		process.stdout.write(output);
		this.previousLines = [...newLines];
	}
}
