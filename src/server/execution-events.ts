export type ExecutionPhase = "planned" | "settled" | "persisted";

export type ExecutionVerificationStatus = "verified" | "unverified" | "insufficient_evidence";

export interface ExecutionPaneSnippet {
	content: string;
	ansiContent?: string;
	lines: number;
	capturedAt: number;
}

export interface ExecutionWorkspaceEvidence {
	workingDir: string;
	available: boolean;
	changedFiles: string[];
	diffStat?: string;
	diffSummary?: string[];
}

export interface ExecutionPersistenceEvidence {
	memoryWrites: string[];
	sessionResumeId?: string;
	sessionResumable?: boolean;
	conversationPersisted: boolean;
}

export interface ExecutionTestEvidence {
	status: "passed" | "failed" | "unknown" | "not_run";
	summary: string;
	command?: string;
}

export interface ExecutionVerificationEvidence {
	status: ExecutionVerificationStatus;
	summary: string;
}

export interface ExecutionEvent {
	id: string;
	runId: string;
	phase: ExecutionPhase;
	toolName: string;
	summary?: string;
	workspace?: ExecutionWorkspaceEvidence;
	pane?: ExecutionPaneSnippet;
	persistence?: ExecutionPersistenceEvidence;
	test?: ExecutionTestEvidence;
	verification?: ExecutionVerificationEvidence;
	createdAt: number;
}

export class ExecutionEventStore {
	private events: ExecutionEvent[] = [];
	private maxEvents: number;

	constructor(maxEvents = 100) {
		this.maxEvents = maxEvents;
	}

	add(event: ExecutionEvent): void {
		this.events.push(event);
		if (this.events.length > this.maxEvents) {
			this.events.splice(0, this.events.length - this.maxEvents);
		}
	}

	listRecent(limit = 50): ExecutionEvent[] {
		return this.events.slice(-limit);
	}

	clear(): void {
		this.events = [];
	}
}
