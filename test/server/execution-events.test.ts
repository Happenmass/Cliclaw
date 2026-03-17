import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExecutionEventStore } from "../../src/server/execution-events.js";

function createEvent(index: number) {
	return {
		id: `evt-${index}`,
		runId: `run-${index}`,
		phase: "planned" as const,
		toolName: "send_to_agent",
		summary: `event-${index}`,
		createdAt: index,
	};
}

describe("ExecutionEventStore", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "cliclaw-exec-events-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("keeps only recent events in memory mode", () => {
		const store = new ExecutionEventStore(2);
		store.add(createEvent(1));
		store.add(createEvent(2));
		store.add(createEvent(3));

		expect(store.listRecent()).toEqual([createEvent(2), createEvent(3)]);
	});

	it("persists and restores events from sqlite", () => {
		const dbPath = join(tmpDir, "events.sqlite");
		const db1 = new Database(dbPath);
		const store1 = new ExecutionEventStore({ db: db1, maxEvents: 10 });
		store1.add(createEvent(1));
		store1.add(createEvent(2));
		db1.close();

		const db2 = new Database(dbPath);
		const store2 = new ExecutionEventStore({ db: db2, maxEvents: 10 });
		expect(store2.listRecent()).toEqual([createEvent(1), createEvent(2)]);
		db2.close();
	});

	it("clears persisted events", () => {
		const dbPath = join(tmpDir, "events.sqlite");
		const db = new Database(dbPath);
		const store = new ExecutionEventStore({ db, maxEvents: 10 });
		store.add(createEvent(1));
		store.add(createEvent(2));

		store.clear();

		expect(store.listRecent()).toEqual([]);
		db.close();
	});
});
