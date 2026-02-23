import type { LLMClient } from "../llm/client.js";
import type { PromptLoader } from "../llm/prompt-loader.js";
import type { LLMMessage } from "../llm/types.js";
import { logger } from "../utils/logger.js";

export interface ContextManagerConfig {
	llmClient: LLMClient;
	promptLoader: PromptLoader;
	contextWindowLimit?: number;
	compressionThreshold?: number;
}

export class ContextManager {
	private llmClient: LLMClient;
	private promptLoader: PromptLoader;
	private contextWindowLimit: number;
	private compressionThreshold: number;

	private promptTemplate: string;
	private modules: Map<string, string> = new Map();
	private conversation: LLMMessage[] = [];

	constructor(config: ContextManagerConfig) {
		this.llmClient = config.llmClient;
		this.promptLoader = config.promptLoader;
		this.contextWindowLimit = config.contextWindowLimit ?? 128000;
		this.compressionThreshold = config.compressionThreshold ?? 0.7;

		this.promptTemplate = this.promptLoader.getRaw("main-agent");
	}

	getSystemPrompt(): string {
		let prompt = this.promptTemplate;
		for (const [key, value] of this.modules) {
			prompt = prompt.replaceAll(`{{${key}}}`, value);
		}
		// Clear any remaining unreplaced variables
		prompt = prompt.replace(/\{\{[\w-]+\}\}/g, "");
		return prompt;
	}

	updateModule(key: string, value: string): void {
		this.modules.set(key, value);
	}

	addMessage(message: LLMMessage): void {
		this.conversation.push(message);
	}

	getMessages(): LLMMessage[] {
		return this.conversation;
	}

	getConversationLength(): number {
		return this.conversation.length;
	}

	shouldCompress(): boolean {
		const totalTokens = this.estimateTokens(this.getSystemPrompt()) + this.estimateTokens(this.conversation);
		const threshold = this.contextWindowLimit * this.compressionThreshold;
		return totalTokens > threshold;
	}

	async compress(): Promise<void> {
		const existingHistory = this.modules.get("compressed_history") ?? "";

		logger.info("context-manager", `Compressing conversation (${this.conversation.length} messages)`);

		const input = JSON.stringify({
			existing_history: existingHistory,
			new_conversation: this.conversation.map((m) => ({
				role: m.role,
				content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
			})),
			current_goal: this.modules.get("goal") ?? "",
			current_task_graph: this.modules.get("task_graph_summary") ?? "",
		});

		const response = await this.llmClient.complete(
			[{ role: "user", content: input }],
			{
				systemPrompt: this.promptLoader.resolve("history-compressor"),
				temperature: 0,
			},
		);

		this.modules.set("compressed_history", response.content.trim());
		this.conversation = [];

		logger.info("context-manager", "Conversation compressed and reset");
	}

	private estimateTokens(input: string | LLMMessage[]): number {
		if (typeof input === "string") {
			return Math.ceil(input.length / 4);
		}
		let totalChars = 0;
		for (const msg of input) {
			if (typeof msg.content === "string") {
				totalChars += msg.content.length;
			} else {
				totalChars += JSON.stringify(msg.content).length;
			}
		}
		return Math.ceil(totalChars / 4);
	}
}
