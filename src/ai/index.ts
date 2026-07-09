import type { Env } from "../config/env.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import type { AIProvider } from "./provider.js";

export function createAIProvider(env: Env): AIProvider {
  switch (env.AI_PROVIDER) {
    case "anthropic":
      return createAnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
    case "openai":
      return createOpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL);
    case "gemini":
      return createGeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
    default: {
      const exhaustiveCheck: never = env.AI_PROVIDER;
      throw new Error(`Unknown AI_PROVIDER: ${String(exhaustiveCheck)}`);
    }
  }
}

export type { AIProvider } from "./provider.js";
