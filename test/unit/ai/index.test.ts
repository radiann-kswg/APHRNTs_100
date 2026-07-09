import { describe, expect, it } from "vitest";
import { createAIProvider } from "../../../src/ai/index.js";
import { loadEnv } from "../../../src/config/env.js";

describe("createAIProvider", () => {
  it("creates an anthropic provider by default", () => {
    const env = loadEnv({ ANTHROPIC_API_KEY: "test-key" });
    const provider = createAIProvider(env);
    expect(provider.name).toBe("anthropic");
  });

  it("creates an openai provider when selected", () => {
    const env = loadEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key" });
    const provider = createAIProvider(env);
    expect(provider.name).toBe("openai");
  });

  it("creates a gemini provider when selected", () => {
    const env = loadEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "test-key" });
    const provider = createAIProvider(env);
    expect(provider.name).toBe("gemini");
  });
});
