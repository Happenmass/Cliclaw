import type Database from "better-sqlite3";

export type UiEventType = "agent_update" | "tool_activity";

export interface UiEvent {
	id: string;
	type: UiEventType;
	summary: string;
	createdAt: number;
}

interface UiEventRow {
	event_json: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ui_events (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	id TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL,
	event_json TEXT NOT NULL
);
`;

export interface UiEventStoreOptions {
	maxEvents?: number;
	db?: Database.Database;
}

export class UiEventStore {
	private events: UiEvent[] = [];
	private maxEvents: number;
	private db: Database.Database | null;

	constructor(options: number | UiEventStoreOptions = 400) {
		if (typeof options === "number") {
			this.maxEvents = options;
			this.db = null;
			return;
		}

		this.maxEvents = options.maxEvents ?? 400;
		this.db = options.db ?? null;
		if (this.db) {
			this.db.exec(SCHEMA_SQL);
		}
	}

	add(event: UiEvent): void {
		if (this.db) {
			this.db
				.prepare("INSERT OR REPLACE INTO ui_events (id, created_at, event_json) VALUES (?, ?, ?)")
				.run(event.id, event.createdAt, JSON.stringify(event));

			this.db
				.prepare(
					`
DELETE FROM ui_events
WHERE seq NOT IN (
	SELECT seq FROM ui_events ORDER BY seq DESC LIMIT ?
)
`,
				)
				.run(this.maxEvents);
			return;
		}

		this.events.push(event);
		if (this.events.length > this.maxEvents) {
			this.events.splice(0, this.events.length - this.maxEvents);
		}
	}

	listRecent(limit = 200): UiEvent[] {
		const safeLimit = Math.max(0, Math.floor(limit));
		if (this.db) {
			const rows = this.db
				.prepare("SELECT event_json FROM ui_events ORDER BY seq DESC LIMIT ?")
				.all(safeLimit) as UiEventRow[];
			return rows
				.reverse()
				.map((row) => {
					try {
						return JSON.parse(row.event_json) as UiEvent;
					} catch {
						return null;
					}
				})
				.filter((event): event is UiEvent => Boolean(event));
		}

		return this.events.slice(-safeLimit);
	}

	clear(): void {
		if (this.db) {
			this.db.exec("DELETE FROM ui_events");
			return;
		}

		this.events = [];
	}
}
