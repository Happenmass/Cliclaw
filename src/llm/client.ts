import { logger } from "../utils/logger.js";
import type {
	LLMClientOptions,
	LLMMessage,
	LLMResponse,
	LLMStreamEvent,
	LLMProvider,
	CompletionOptions,
} from "./types.js";
import { resolveProvider } from "./providers/registry.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { AnthropicProvider } from "./providers/anthropic.js";

/**
 * Unified LLM client that dispatches to the correct provider based on protocol.
 *
 * Usage:
 *   const client = new LLMClient({ provider: "openai", model: "gpt-4o" });
 *   const client = new LLMClient({ provider: "anthropic", model: "claude-sonnet-4-5-20250929" });
 *   const client = new LLMClient({ provider: "openrouter", model: "anthropic/claude-opus-4-6" });
 *   const client = new LLMClient({ provider: "moonshot", model: "moonshot-v1-auto" });
 *   const client = new LLMClient({ provider: "deepseek" });   // uses default model
 *   const client = new LLMClient({ provider: "ollama", model: "llama3.3" });
 *
 * Custom provider:
 *   const client = new LLMClient({ provider: "my-corp", baseUrl: "https://llm.my-corp.com/v1", model: "internal-v2" });
 */
export class LLMClient {
	private provider: LLMProvider;
	private providerName: string;
	private currentModel: string;

	constructor(opts: LLMClientOptions) {
		this.providerName = opts.provider;
		const config = resolveProvider(opts.provider, {
			baseUrl: opts.baseUrl,
			apiKey: opts.apiKey,
		});

		this.currentModel = opts.model || config.defaultModel;

		const providerOpts = {
			model: this.currentModel,
			apiKey: opts.apiKey,
			maxRetries: opts.maxRetries,
			timeout: opts.timeout,
		};

		switch (config.protocol) {
			case "anthropic":
				this.provider = new AnthropicProvider(config, providerOpts);
				break;
			case "openai-compatible":
			default:
				this.provider = new OpenAICompatibleProvider(config, providerOpts);
				break;
		}

		logger.info("llm", `Initialized ${config.displayName} provider (model: ${this.currentModel})`);
	}

	async complete(messages: LLMMessage[], opts?: CompletionOptions): Promise<LLMResponse> {
		return this.provider.complete(messages, opts);
	}

	async *stream(messages: LLMMessage[], opts?: CompletionOptions): AsyncIterable<LLMStreamEvent> {
		yield* this.provider.stream(messages, opts);
	}

	/**
	 * Complete and parse the response as JSON.
	 * Handles markdown code blocks wrapping the JSON.
	 */
	async completeJson<T = any>(messages: LLMMessage[], opts?: CompletionOptions): Promise<T> {
		const response = await this.complete(messages, opts);
		const content = response.content.trim();

		// Extract JSON from markdown code blocks if present
		const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
		const jsonStr = jsonMatch ? jsonMatch[1].trim() : content;

		try {
			return JSON.parse(jsonStr);
		} catch (err) {
			logger.error("llm", `Failed to parse JSON response: ${content.substring(0, 300)}`);
			throw new Error(`LLM returned invalid JSON: ${(err as Error).message}`);
		}
	}

	getModel(): string {
		return this.currentModel;
	}

	getProviderName(): string {
		return this.providerName;
	}

	getProtocol(): string {
		return this.provider.protocol;
	}
}
