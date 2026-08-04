import type { Env } from "../config/env.js";
import type { Logger } from "../utils/logger.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import type { AIProvider } from "./provider.js";

/** loggerは任意。渡すと、空応答など切り分けに必要な診断ログがプロバイダー側から出る。 */
export function createAIProvider(env: Env, logger?: Logger): AIProvider {
  switch (env.AI_PROVIDER) {
    case "anthropic":
      return createAnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL, undefined, logger);
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
