export const config = {
  models: {
    low: "gemini",
    med: "gemini",
    high: "gemini",
  },
  apiKeys: {
    gemini: process.env.GEMINI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  }
};
