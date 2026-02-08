import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getLogsDir } from "./config.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	timestamp: number;
	level: LogLevel;
	module: string;
	message: string;
}

type LogListener = (entry: LogEntry) => void;

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

class Logger {
	private minLevel: LogLevel = "info";
	private logFile: string | null = null;
	private listeners: LogListener[] = [];
	private initPromise: Promise<void> | null = null;

	async init(): Promise<void> {
		if (this.initPromise) return this.initPromise;
		this.initPromise = this._init();
		return this.initPromise;
	}

	private async _init(): Promise<void> {
		const logsDir = await getLogsDir();
		const date = new Date().toISOString().split("T")[0];
		this.logFile = join(logsDir, `${date}.log`);
	}

	setLevel(level: LogLevel): void {
		this.minLevel = level;
	}

	subscribe(listener: LogListener): () => void {
		this.listeners.push(listener);
		return () => {
			const idx = this.listeners.indexOf(listener);
			if (idx >= 0) this.listeners.splice(idx, 1);
		};
	}

	private async log(level: LogLevel, module: string, message: string): Promise<void> {
		if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) return;

		const entry: LogEntry = {
			timestamp: Date.now(),
			level,
			module,
			message,
		};

		// Notify listeners (TUI log stream)
		for (const listener of this.listeners) {
			try {
				listener(entry);
			} catch {
				// Ignore listener errors
			}
		}

		// Write to file
		if (this.logFile) {
			const time = new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false });
			const line = `[${time}] [${level.toUpperCase().padEnd(5)}] [${module}] ${message}\n`;
			await appendFile(this.logFile, line).catch(() => {});
		}
	}

	debug(module: string, message: string): void {
		this.log("debug", module, message);
	}

	info(module: string, message: string): void {
		this.log("info", module, message);
	}

	warn(module: string, message: string): void {
		this.log("warn", module, message);
	}

	error(module: string, message: string): void {
		this.log("error", module, message);
	}
}

export const logger = new Logger();
