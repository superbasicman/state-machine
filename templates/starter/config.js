export const config = {
  models: {
    low: "gemini",
    med: "codex --model gpt-5.2",
    high: "claude -m claude-opus-4-20250514 -p",
  },
  apiKeys: {
    gemini: process.env.GEMINI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  }
};
