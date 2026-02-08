import { TUIRenderer } from "./components/renderer.js";
import { Dashboard } from "./dashboard.js";
import { ConfigView } from "./config-view.js";
import type { Scheduler } from "../core/scheduler.js";
import type { TaskGraph } from "../core/task.js";
import type { TmuxBridge } from "../tmux/bridge.js";
import { loadConfig, saveConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export class AppTUI {
	private renderer: TUIRenderer;
	private dashboard: Dashboard;
	private scheduler: Scheduler;
	private bridge: TmuxBridge;
	private refreshTimer: ReturnType<typeof setInterval> | null = null;
	private activePaneTarget: string | null = null;
	private configOverlayActive = false;
	private configView: ConfigView | null = null;

	constructor(scheduler: Scheduler, bridge: TmuxBridge, goal: string) {
		this.renderer = new TUIRenderer();
		this.dashboard = new Dashboard();
		this.scheduler = scheduler;
		this.bridge = bridge;

		this.dashboard.setGoal(goal);
		this.renderer.setRoot(this.dashboard);

		this.setupEventListeners();
		this.setupInputHandler();
	}

	start(): void {
		this.renderer.start();

		// Refresh agent preview periodically
		this.refreshTimer = setInterval(() => {
			this.refreshAgentPreview();
			this.refreshTaskList();
			this.renderer.requestRender();
		}, 2000);
	}

	stop(): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.renderer.stop();
	}

	private setupEventListeners(): void {
		this.scheduler.on("task_start", (task) => {
			this.dashboard.addLog(`Starting: ${task.title}`, "info");
			this.refreshTaskList();
			this.renderer.requestRender();
		});

		this.scheduler.on("task_complete", (task) => {
			this.dashboard.addLog(`Completed: ${task.title}`, "info");
			this.refreshTaskList();
			this.renderer.requestRender();
		});

		this.scheduler.on("task_failed", (task, error) => {
			this.dashboard.addLog(`Failed: ${task.title} — ${error}`, "error");
			this.refreshTaskList();
			this.renderer.requestRender();
		});

		this.scheduler.on("need_human", (task, reason) => {
			this.dashboard.addLog(`Needs attention: ${task.title} — ${reason}`, "warn");
			this.renderer.requestRender();
		});

		this.scheduler.on("state_update", (analysis, task) => {
			if (analysis.status !== "active") {
				this.dashboard.addLog(`[${task.title}] ${analysis.detail}`);
				this.renderer.requestRender();
			}
		});

		this.scheduler.on("all_complete", (progress) => {
			this.dashboard.addLog(`All complete: ${progress.completed}/${progress.total} succeeded`);
			this.refreshTaskList();
			this.renderer.requestRender();
		});

		this.scheduler.on("log", (message) => {
			this.dashboard.addLog(message);
			this.renderer.requestRender();
		});
	}

	private setupInputHandler(): void {
		this.renderer.setInputHandler((data: string) => {
			// If config overlay is active, delegate to config view
			if (this.configOverlayActive && this.configView) {
				this.configView.handleInput(data);
				this.renderer.requestRender();
				return;
			}

			switch (data) {
				case "q":
					this.scheduler.abort();
					this.stop();
					process.exit(0);
					break;

				case "p":
					if (this.scheduler.isPaused()) {
						this.scheduler.resume();
						this.dashboard.addLog("Resumed");
					} else {
						this.scheduler.pause();
						this.dashboard.addLog("Paused");
					}
					this.renderer.requestRender();
					break;

				case "c":
					this.openConfigOverlay();
					break;

				case "s":
					// TODO: Open steer input
					this.dashboard.addLog("Steer mode not yet implemented", "warn");
					this.renderer.requestRender();
					break;

				case "\t": // Tab
					// TODO: Switch to tmux agent view
					this.dashboard.addLog("Agent view switch not yet implemented", "warn");
					this.renderer.requestRender();
					break;
			}
		});
	}

	private async openConfigOverlay(): Promise<void> {
		const config = await loadConfig();
		this.configView = new ConfigView(config, {
			onSave: async (updatedConfig) => {
				await saveConfig(updatedConfig);
				this.dashboard.addLog("Configuration saved");
			},
			onClose: () => {
				this.closeConfigOverlay();
			},
		});
		this.configOverlayActive = true;
		this.renderer.setRoot(this.configView);
		this.renderer.requestRender();
	}

	private closeConfigOverlay(): void {
		this.configOverlayActive = false;
		this.configView = null;
		this.renderer.setRoot(this.dashboard);
		this.renderer.requestRender();
	}

	private refreshTaskList(): void {
		const graph = this.scheduler.getTaskGraph();
		this.dashboard.setTasks(graph.getAllTasks());
		this.dashboard.setProgress(graph.getProgress());
	}

	private async refreshAgentPreview(): Promise<void> {
		// TODO: Capture active agent pane and update preview
		// This will be connected when scheduler tracks active pane targets
	}

	setActivePaneTarget(target: string | null): void {
		this.activePaneTarget = target;
	}
}
