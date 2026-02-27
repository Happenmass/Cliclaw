import type { ProviderConfig } from "../types.js";

/** Built-in provider configurations */
export const BUILTIN_PROVIDERS: ProviderConfig[] = [
	// ─── OpenAI ──────────────────────────────────────────
	{
		name: "openai",
		displayName: "OpenAI",
		protocol: "openai-compatible",
		baseUrl: "https://api.openai.com/v1",
		apiKeyEnvVar: "OPENAI_API_KEY",
		defaultModel: "gpt-4o",
		models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o3", "o4-mini"],
	},

	// ─── Anthropic ───────────────────────────────────────
	{
		name: "anthropic",
		displayName: "Anthropic",
		protocol: "anthropic",
		baseUrl: "https://api.anthropic.com",
		apiKeyEnvVar: "ANTHROPIC_API_KEY",
		defaultModel: "claude-sonnet-4-5-20250929",
		models: ["claude-opus-4-6", "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"],
	},

	// ─── OpenRouter ──────────────────────────────────────
	{
		name: "openrouter",
		displayName: "OpenRouter",
		protocol: "openai-compatible",
		baseUrl: "https://openrouter.ai/api/v1",
		apiKeyEnvVar: "OPENROUTER_API_KEY",
		defaultModel: "anthropic/claude-sonnet-4-5-20250929",
		models: [
			"anthropic/claude-opus-4-6",
			"anthropic/claude-sonnet-4-5-20250929",
			"openai/gpt-4o",
			"google/gemini-2.5-flash",
			"deepseek/deepseek-chat-v3-0324",
		],
	},

	// ─── Moonshot (Kimi) ─────────────────────────────────
	{
		name: "moonshot",
		displayName: "Moonshot (Kimi)",
		protocol: "openai-compatible",
		baseUrl: "https://api.moonshot.cn/v1",
		apiKeyEnvVar: "MOONSHOT_API_KEY",
		defaultModel: "moonshot-v1-auto",
		models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "moonshot-v1-auto"],
	},

	// ─── MiniMax ─────────────────────────────────────────
	{
		name: "minimax",
		displayName: "MiniMax",
		protocol: "openai-compatible",
		baseUrl: "https://api.minimax.chat/v1",
		apiKeyEnvVar: "MINIMAX_API_KEY",
		defaultModel: "MiniMax-Text-01",
		models: ["MiniMax-Text-01", "abab6.5s-chat"],
	},

	// ─── DeepSeek ────────────────────────────────────────
	{
		name: "deepseek",
		displayName: "DeepSeek",
		protocol: "openai-compatible",
		baseUrl: "https://api.deepseek.com/v1",
		apiKeyEnvVar: "DEEPSEEK_API_KEY",
		defaultModel: "deepseek-chat",
		models: ["deepseek-chat", "deepseek-reasoner"],
	},

	// ─── Groq ────────────────────────────────────────────
	{
		name: "groq",
		displayName: "Groq",
		protocol: "openai-compatible",
		baseUrl: "https://api.groq.com/openai/v1",
		apiKeyEnvVar: "GROQ_API_KEY",
		defaultModel: "llama-3.3-70b-versatile",
		models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
	},

	// ─── Together AI ─────────────────────────────────────
	{
		name: "together",
		displayName: "Together AI",
		protocol: "openai-compatible",
		baseUrl: "https://api.together.xyz/v1",
		apiKeyEnvVar: "TOGETHER_API_KEY",
		defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
	},

	// ─── xAI (Grok) ─────────────────────────────────────
	{
		name: "xai",
		displayName: "xAI (Grok)",
		protocol: "openai-compatible",
		baseUrl: "https://api.x.ai/v1",
		apiKeyEnvVar: "XAI_API_KEY",
		defaultModel: "grok-3",
		models: ["grok-3", "grok-3-mini"],
	},

	// ─── Google Gemini (OpenAI compat) ───────────────────
	{
		name: "gemini",
		displayName: "Google Gemini",
		protocol: "openai-compatible",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
		apiKeyEnvVar: "GEMINI_API_KEY",
		defaultModel: "gemini-2.5-flash",
		models: ["gemini-2.5-flash", "gemini-2.5-pro"],
	},

	// ─── Mistral ─────────────────────────────────────────
	{
		name: "mistral",
		displayName: "Mistral",
		protocol: "openai-compatible",
		baseUrl: "https://api.mistral.ai/v1",
		apiKeyEnvVar: "MISTRAL_API_KEY",
		defaultModel: "mistral-large-latest",
		models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
	},

	// ─── Ollama (local) ──────────────────────────────────
	{
		name: "ollama",
		displayName: "Ollama (Local)",
		protocol: "openai-compatible",
		baseUrl: "http://localhost:11434/v1",
		apiKeyEnvVar: "OLLAMA_API_KEY", // Usually "ollama" or empty
		defaultModel: "llama3.3",
	},
];

const providerMap = new Map<string, ProviderConfig>();

// Initialize with builtins
for (const p of BUILTIN_PROVIDERS) {
	providerMap.set(p.name, p);
}

export function getProvider(name: string): ProviderConfig | undefined {
	return providerMap.get(name);
}

export function getAllProviders(): ProviderConfig[] {
	return Array.from(providerMap.values());
}

export function registerProvider(config: ProviderConfig): void {
	providerMap.set(config.name, config);
}

/**
 * Resolve a provider by name, with optional overrides.
 * Also supports passing a custom baseUrl directly (creates an ad-hoc openai-compatible provider).
 */
export function resolveProvider(name: string, overrides?: { baseUrl?: string; apiKey?: string }): ProviderConfig {
	const config = getProvider(name);

	if (config) {
		return {
			...config,
			...(overrides?.baseUrl ? { baseUrl: overrides.baseUrl } : {}),
		};
	}

	// Unknown provider — treat as custom OpenAI-compatible endpoint
	return {
		name,
		displayName: name,
		protocol: "openai-compatible",
		baseUrl: overrides?.baseUrl || `https://api.${name}.com/v1`,
		apiKeyEnvVar: `${name.toUpperCase().replace(/-/g, "_")}_API_KEY`,
		defaultModel: "default",
	};
}
