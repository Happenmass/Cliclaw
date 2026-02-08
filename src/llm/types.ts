// ─── Messages ────────────────────────────────────────────

export interface TextContent {
	type: "text";
	text: string;
}

export interface ImageContent {
	type: "image";
	data: string; // base64
	mimeType: string;
}

export interface ToolCallContent {
	type: "tool_call";
	id: string;
	name: string;
	arguments: Record<string, any>;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
}

export type MessageContent = TextContent | ImageContent | ToolCallContent | ThinkingContent;

export interface LLMMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | MessageContent[];
	/** For role: "tool" — the tool_call_id this result responds to */
	toolCallId?: string;
	name?: string;
}

// ─── Tools ───────────────────────────────────────────────

export interface ToolParameter {
	type: string;
	description?: string;
	enum?: string[];
	items?: ToolParameter;
	properties?: Record<string, ToolParameter>;
	required?: string[];
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, ToolParameter>;
		required?: string[];
	};
}

// ─── Response ────────────────────────────────────────────

export interface LLMUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface LLMResponse {
	content: string;
	contentBlocks: MessageContent[];
	usage: LLMUsage;
	stopReason: string;
	model: string;
}

// ─── Streaming ───────────────────────────────────────────

export type LLMStreamEvent =
	| { type: "text_delta"; delta: string }
	| { type: "thinking_delta"; delta: string }
	| { type: "tool_call_delta"; index: number; id?: string; name?: string; argumentsDelta: string }
	| { type: "done"; response: LLMResponse };

// ─── Options ─────────────────────────────────────────────

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

export interface CompletionOptions {
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
	systemPrompt?: string;
	tools?: ToolDefinition[];
	toolChoice?: "auto" | "none" | "required" | { name: string };
	responseFormat?: "text" | "json";
	thinking?: ThinkingLevel;
}

// ─── Provider ────────────────────────────────────────────

export type ProviderProtocol = "openai-compatible" | "anthropic";

export interface ProviderConfig {
	/** Unique provider identifier */
	name: string;
	/** Display name */
	displayName: string;
	/** Which API protocol to use */
	protocol: ProviderProtocol;
	/** Base URL for the API */
	baseUrl: string;
	/** Environment variable name for the API key */
	apiKeyEnvVar: string;
	/** Default model ID */
	defaultModel: string;
	/** Available models (optional, for listing) */
	models?: string[];
	/** Custom headers to include in requests */
	headers?: Record<string, string>;
}

export interface LLMClientOptions {
	provider: string;
	model?: string;
	apiKey?: string;
	baseUrl?: string;
	maxRetries?: number;
	timeout?: number;
}

// ─── Provider Implementation Interface ───────────────────

export interface LLMProvider {
	readonly name: string;
	readonly protocol: ProviderProtocol;

	complete(messages: LLMMessage[], opts?: CompletionOptions): Promise<LLMResponse>;
	stream(messages: LLMMessage[], opts?: CompletionOptions): AsyncIterable<LLMStreamEvent>;
}
