export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface TaskResult {
	success: boolean;
	summary: string;
	filesChanged?: string[];
	errors?: string[];
}

export interface Task {
	id: string;
	title: string;
	description: string;
	status: TaskStatus;
	dependencies: string[];
	agentType?: string;
	prompt?: string;
	result?: TaskResult;
	attempts: number;
	maxAttempts: number;
	estimatedComplexity: "low" | "medium" | "high";
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
}

export interface TaskProgress {
	total: number;
	completed: number;
	failed: number;
	running: number;
	pending: number;
	skipped: number;
}

export class TaskGraph {
	private tasks = new Map<string, Task>();

	addTask(task: Task): void {
		this.tasks.set(task.id, task);
	}

	getTask(id: string): Task | undefined {
		return this.tasks.get(id);
	}

	getAllTasks(): Task[] {
		return Array.from(this.tasks.values());
	}

	updateStatus(id: string, status: TaskStatus, result?: TaskResult): void {
		const task = this.tasks.get(id);
		if (!task) throw new Error(`Task ${id} not found`);

		task.status = status;

		if (status === "running") {
			task.startedAt = Date.now();
			task.attempts++;
		}

		if (status === "completed" || status === "failed" || status === "skipped") {
			task.completedAt = Date.now();
		}

		if (result) {
			task.result = result;
		}
	}

	/** Get tasks whose dependencies are all completed and that are still pending */
	getReadyTasks(): Task[] {
		return this.getAllTasks().filter((task) => {
			if (task.status !== "pending") return false;
			return task.dependencies.every((depId) => {
				const dep = this.tasks.get(depId);
				return dep && (dep.status === "completed" || dep.status === "skipped");
			});
		});
	}

	getRunningTasks(): Task[] {
		return this.getAllTasks().filter((t) => t.status === "running");
	}

	isComplete(): boolean {
		return this.getAllTasks().every(
			(t) => t.status === "completed" || t.status === "failed" || t.status === "skipped",
		);
	}

	isDeadlocked(): boolean {
		const pending = this.getAllTasks().filter((t) => t.status === "pending");
		const running = this.getAllTasks().filter((t) => t.status === "running");

		if (pending.length === 0 || running.length > 0) return false;

		// All pending tasks have unmet dependencies
		return this.getReadyTasks().length === 0;
	}

	getProgress(): TaskProgress {
		const all = this.getAllTasks();
		return {
			total: all.length,
			completed: all.filter((t) => t.status === "completed").length,
			failed: all.filter((t) => t.status === "failed").length,
			running: all.filter((t) => t.status === "running").length,
			pending: all.filter((t) => t.status === "pending").length,
			skipped: all.filter((t) => t.status === "skipped").length,
		};
	}

	toJSON(): object {
		return {
			tasks: this.getAllTasks(),
		};
	}

	static fromJSON(data: { tasks: Task[] }): TaskGraph {
		const graph = new TaskGraph();
		for (const task of data.tasks) {
			graph.addTask(task);
		}
		return graph;
	}
}
