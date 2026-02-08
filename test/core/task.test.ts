import { describe, it, expect } from "vitest";
import { TaskGraph, type Task } from "../../src/core/task.js";

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
	return {
		status: "pending",
		description: "",
		dependencies: [],
		attempts: 0,
		maxAttempts: 3,
		estimatedComplexity: "low",
		createdAt: Date.now(),
		...overrides,
	};
}

describe("TaskGraph", () => {
	it("should add and retrieve tasks", () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2" }));

		expect(graph.getTask("1")?.title).toBe("Task 1");
		expect(graph.getTask("2")?.title).toBe("Task 2");
		expect(graph.getAllTasks().length).toBe(2);
	});

	it("should report ready tasks (no dependencies)", () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2" }));

		const ready = graph.getReadyTasks();
		expect(ready.length).toBe(2);
	});

	it("should respect dependencies for ready tasks", () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2", dependencies: ["1"] }));
		graph.addTask(makeTask({ id: "3", title: "Task 3", dependencies: ["1", "2"] }));

		// Only task 1 should be ready
		let ready = graph.getReadyTasks();
		expect(ready.length).toBe(1);
		expect(ready[0].id).toBe("1");

		// Complete task 1
		graph.updateStatus("1", "completed");
		ready = graph.getReadyTasks();
		expect(ready.length).toBe(1);
		expect(ready[0].id).toBe("2");

		// Complete task 2
		graph.updateStatus("2", "completed");
		ready = graph.getReadyTasks();
		expect(ready.length).toBe(1);
		expect(ready[0].id).toBe("3");
	});

	it("should correctly report completion", () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2" }));

		expect(graph.isComplete()).toBe(false);

		graph.updateStatus("1", "completed");
		expect(graph.isComplete()).toBe(false);

		graph.updateStatus("2", "completed");
		expect(graph.isComplete()).toBe(true);
	});

	it("should detect deadlock", () => {
		const graph = new TaskGraph();
		// Circular dependency creates deadlock
		graph.addTask(makeTask({ id: "1", title: "Task 1", dependencies: ["2"] }));
		graph.addTask(makeTask({ id: "2", title: "Task 2", dependencies: ["1"] }));

		expect(graph.isDeadlocked()).toBe(true);
		expect(graph.getReadyTasks().length).toBe(0);
	});

	it("should track progress correctly", () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2" }));
		graph.addTask(makeTask({ id: "3", title: "Task 3" }));

		expect(graph.getProgress()).toEqual({
			total: 3,
			completed: 0,
			failed: 0,
			running: 0,
			pending: 3,
			skipped: 0,
		});

		graph.updateStatus("1", "running");
		expect(graph.getProgress().running).toBe(1);
		expect(graph.getProgress().pending).toBe(2);

		graph.updateStatus("1", "completed");
		graph.updateStatus("2", "failed");
		expect(graph.getProgress()).toEqual({
			total: 3,
			completed: 1,
			failed: 1,
			running: 0,
			pending: 1,
			skipped: 0,
		});
	});

	it("should serialize and deserialize", () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2", dependencies: ["1"] }));
		graph.updateStatus("1", "completed", { success: true, summary: "done" });

		const json = graph.toJSON();
		const restored = TaskGraph.fromJSON(json as any);

		expect(restored.getAllTasks().length).toBe(2);
		expect(restored.getTask("1")?.status).toBe("completed");
		expect(restored.getTask("2")?.dependencies).toEqual(["1"]);
	});

	it("should treat skipped tasks as completed for dependency resolution", () => {
		const graph = new TaskGraph();
		graph.addTask(makeTask({ id: "1", title: "Task 1" }));
		graph.addTask(makeTask({ id: "2", title: "Task 2", dependencies: ["1"] }));

		graph.updateStatus("1", "skipped");
		const ready = graph.getReadyTasks();
		expect(ready.length).toBe(1);
		expect(ready[0].id).toBe("2");
	});
});
