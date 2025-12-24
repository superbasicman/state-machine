export const config = {
  models: {
    fast: "gemini",
    low: "gemini",
    med: "gemini",
    high: "gemini",
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
