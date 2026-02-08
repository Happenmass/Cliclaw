import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_MEMORY_CHARS = 2000;

export class Memory {
	private baseDir: string;
	private projectDir: string;
	private globalContent = "";
	private contextContent = "";
	private lessonsContent = "";

	constructor(projectDir: string) {
		const hash = createHash("sha256").update(projectDir).digest("hex").slice(0, 12);
		this.baseDir = join(homedir(), ".clipilot", "memory");
		this.projectDir = join(this.baseDir, "projects", hash);
	}

	async ensureDirs(): Promise<void> {
		await mkdir(this.baseDir, { recursive: true });
		await mkdir(this.projectDir, { recursive: true });
	}

	async load(): Promise<void> {
		await this.ensureDirs();

		this.globalContent = await this.safeRead(join(this.baseDir, "global.md"));
		this.contextContent = await this.safeRead(join(this.projectDir, "context.md"));
		this.lessonsContent = await this.safeRead(join(this.projectDir, "lessons.md"));
	}

	getFormattedMemory(): string {
		const parts: string[] = [];

		if (this.globalContent) {
			parts.push(`## Global Memory\n${this.globalContent}`);
		}
		if (this.contextContent) {
			parts.push(`## Project Context\n${this.contextContent}`);
		}
		if (this.lessonsContent) {
			parts.push(`## Lessons Learned\n${this.lessonsContent}`);
		}

		if (parts.length === 0) return "";

		let result = `\n\n---\n# Memory\n${parts.join("\n\n")}`;

		if (result.length > MAX_MEMORY_CHARS) {
			result = `${result.slice(0, MAX_MEMORY_CHARS)}\n...(truncated)`;
		}

		// Escape {{ to prevent template variable injection
		result = result.replace(/\{\{/g, "{ {");

		return result;
	}

	async remember(text: string): Promise<void> {
		await this.ensureDirs();
		const entry = `\n- ${text}\n`;
		await appendFile(join(this.projectDir, "context.md"), entry, "utf-8");
		this.contextContent += entry;
	}

	async recordLesson(lesson: string): Promise<void> {
		await this.ensureDirs();
		const entry = `\n- ${lesson}\n`;
		await appendFile(join(this.projectDir, "lessons.md"), entry, "utf-8");
		this.lessonsContent += entry;
	}

	async rememberGlobal(text: string): Promise<void> {
		await this.ensureDirs();
		const entry = `\n- ${text}\n`;
		await appendFile(join(this.baseDir, "global.md"), entry, "utf-8");
		this.globalContent += entry;
	}

	private async safeRead(filePath: string): Promise<string> {
		try {
			return await readFile(filePath, "utf-8");
		} catch {
			return "";
		}
	}
}
