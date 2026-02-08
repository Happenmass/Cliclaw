export interface TmuxSession {
	name: string;
	windows: number;
	created: number;
	attached: boolean;
}

export interface TmuxWindow {
	index: number;
	name: string;
	active: boolean;
	panes: number;
}

export interface TmuxPane {
	id: string;
	index: number;
	width: number;
	height: number;
	active: boolean;
	pid: number;
	currentCommand: string;
}

export interface CaptureResult {
	content: string;
	lines: string[];
	timestamp: number;
}

export interface CaptureOptions {
	startLine?: number;
	endLine?: number;
	escapeSequences?: boolean;
}

export interface SendKeysOptions {
	literal?: boolean;
	delay?: number;
}

export class TmuxError extends Error {
	constructor(
		message: string,
		public readonly command: string,
		public readonly exitCode: number | null,
		public readonly stderr: string,
	) {
		super(message);
		this.name = "TmuxError";
	}
}
