/**
 * OpenAI-Compatible Vendor Plugin
 *
 * Supports any OpenAI-compatible API (Doubao, DeepSeek, Moonshot, etc.)
 * Configuration via environment variables or direct editing.
 */

export const vendor = {
  id: "openai-compatible",
  name: "OpenAI Compatible Provider",
  models: [
    {
      id: "default",
      name: "Default Model",
      type: "chat" as const,
      maxTokens: 4096,
      supportsStreaming: true,
      supportsThinking: true,
    },
  ],

  get baseUrl(): string {
    return process.env.AI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "";
  },

  get apiKey(): string {
    return process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ARK_API_KEY ?? "";
  },
};
