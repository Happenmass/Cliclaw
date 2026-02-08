import { describe, it, expect } from "vitest";
import { getProvider, getAllProviders, resolveProvider, registerProvider } from "../../src/llm/providers/registry.js";
import { LLMClient } from "../../src/llm/client.js";

describe("Provider Registry", () => {
	it("should have all built-in providers", () => {
		const providers = getAllProviders();
		const names = providers.map((p) => p.name);

		expect(names).toContain("openai");
		expect(names).toContain("anthropic");
		expect(names).toContain("openrouter");
		expect(names).toContain("moonshot");
		expect(names).toContain("minimax");
		expect(names).toContain("deepseek");
		expect(names).toContain("groq");
		expect(names).toContain("together");
		expect(names).toContain("xai");
		expect(names).toContain("gemini");
		expect(names).toContain("mistral");
		expect(names).toContain("ollama");
	});

	it("should get a specific provider by name", () => {
		const openai = getProvider("openai");
		expect(openai).toBeDefined();
		expect(openai!.protocol).toBe("openai-compatible");
		expect(openai!.baseUrl).toContain("openai.com");

		const anthropic = getProvider("anthropic");
		expect(anthropic).toBeDefined();
		expect(anthropic!.protocol).toBe("anthropic");
	});

	it("should resolve known providers", () => {
		const config = resolveProvider("deepseek");
		expect(config.name).toBe("deepseek");
		expect(config.protocol).toBe("openai-compatible");
		expect(config.baseUrl).toContain("deepseek.com");
		expect(config.defaultModel).toBe("deepseek-chat");
	});

	it("should resolve unknown providers as custom openai-compatible", () => {
		const config = resolveProvider("my-custom-llm", {
			baseUrl: "https://llm.example.com/v1",
		});
		expect(config.name).toBe("my-custom-llm");
		expect(config.protocol).toBe("openai-compatible");
		expect(config.baseUrl).toBe("https://llm.example.com/v1");
		expect(config.apiKeyEnvVar).toBe("MY_CUSTOM_LLM_API_KEY");
	});

	it("should allow registering custom providers", () => {
		registerProvider({
			name: "test-provider",
			displayName: "Test Provider",
			protocol: "openai-compatible",
			baseUrl: "https://test.example.com/v1",
			apiKeyEnvVar: "TEST_API_KEY",
			defaultModel: "test-model",
		});

		const p = getProvider("test-provider");
		expect(p).toBeDefined();
		expect(p!.displayName).toBe("Test Provider");
	});

	it("should resolve with baseUrl override", () => {
		const config = resolveProvider("openai", {
			baseUrl: "https://custom-openai-proxy.example.com/v1",
		});
		expect(config.baseUrl).toBe("https://custom-openai-proxy.example.com/v1");
		expect(config.protocol).toBe("openai-compatible");
	});

	it("OpenAI-compatible providers should have correct env vars", () => {
		expect(getProvider("moonshot")!.apiKeyEnvVar).toBe("MOONSHOT_API_KEY");
		expect(getProvider("minimax")!.apiKeyEnvVar).toBe("MINIMAX_API_KEY");
		expect(getProvider("groq")!.apiKeyEnvVar).toBe("GROQ_API_KEY");
		expect(getProvider("xai")!.apiKeyEnvVar).toBe("XAI_API_KEY");
	});
});

describe("LLMClient creation", () => {
	it("should create an openai-compatible client", () => {
		const client = new LLMClient({
			provider: "openai",
			model: "gpt-4o-mini",
			apiKey: "test-key",
		});

		expect(client.getProviderName()).toBe("openai");
		expect(client.getModel()).toBe("gpt-4o-mini");
		expect(client.getProtocol()).toBe("openai-compatible");
	});

	it("should create an anthropic client", () => {
		const client = new LLMClient({
			provider: "anthropic",
			model: "claude-haiku-4-5-20251001",
			apiKey: "test-key",
		});

		expect(client.getProviderName()).toBe("anthropic");
		expect(client.getModel()).toBe("claude-haiku-4-5-20251001");
		expect(client.getProtocol()).toBe("anthropic");
	});

	it("should create clients for all OpenAI-compatible providers", () => {
		const oaiProviders = ["openrouter", "moonshot", "minimax", "deepseek", "groq", "together", "xai", "gemini", "mistral", "ollama"];

		for (const name of oaiProviders) {
			const client = new LLMClient({ provider: name, apiKey: "test-key" });
			expect(client.getProtocol()).toBe("openai-compatible");
			expect(client.getProviderName()).toBe(name);
		}
	});

	it("should use default model when not specified", () => {
		const client = new LLMClient({ provider: "deepseek", apiKey: "test-key" });
		expect(client.getModel()).toBe("deepseek-chat");
	});

	it("should create a client for unknown provider with custom baseUrl", () => {
		const client = new LLMClient({
			provider: "internal-corp",
			baseUrl: "https://llm.corp.internal/v1",
			model: "corp-model-v3",
			apiKey: "test-key",
		});

		expect(client.getProviderName()).toBe("internal-corp");
		expect(client.getModel()).toBe("corp-model-v3");
		expect(client.getProtocol()).toBe("openai-compatible");
	});
});
