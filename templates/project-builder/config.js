export const config = {
  models: {
    fast: "gemini -m gemini-2.5-pro",
    low: "gemini -m gemini-2.5-pro",
    med: "gemini -m gemini-2.5-pro",
    high: "gemini -m gemini-2.5-pro",
  },
  apiKeys: {
    gemini: process.env.GEMINI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  },

  // File tracking (all optional - shown with defaults)
  // projectRoot: process.env.PROJECT_ROOT,  // Defaults to ../.. from workflow
  // fileTracking: true,                     // Enable/disable file tracking
  // fileTrackingIgnore: [                   // Glob patterns to ignore
  //   'node_modules/**',
  //   '.git/**',
  //   'dist/**',
  //   'workflows/**'
  // ],
  // fileTrackingKeepDeleted: false          // Keep deleted files in tree
};
