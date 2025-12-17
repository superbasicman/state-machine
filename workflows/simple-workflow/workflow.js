/**
 * simple-workflow Workflow
 * 
 * Define your workflow steps here. Steps can be:
 * - String: "agent:name" or "script:file.js"
 * - Conditional: { if: (context, loop) => condition, true: { goto }, false: { goto } }
 * - Loop: { forEach: (context) => array, as: "itemName", steps: [...], parallel: false }
 */

module.exports = {
  name: "simple-workflow",
  description: "simple-workflow workflow",
  version: "1.0.0",
  
  // Define your models here - use any key name you want
  // CLI commands: just the command to run
  // API calls: "api:provider:model-name"
  models: {
    codex: "codex --model gpt-5.1-codex",
    med: "claude --model claude-sonnet-4-20250514 -p",
    fast: "claude -p",                              // Claude CLI (fast, printing mode)
    smart: "claude --model claude-sonnet-4-20250514 -p",   // Claude Sonnet
    genius: "claude --model claude-opus-4-20250514 -p",    // Claude Opus
    // gemini: "gemini",                            // Gemini CLI (if installed)
    // codex: "codex",                              // Codex CLI (if installed)
    // API examples (requires SDK installed):
    // apiClaude: "api:anthropic:claude-sonnet-4-20250514",
    // apiGpt4: "api:openai:gpt-4-turbo",
  },
  
  // API keys (optional - can also use environment variables)
  apiKeys: {
    // anthropic: process.env.ANTHROPIC_API_KEY,
    // openai: process.env.OPENAI_API_KEY,
  },
  
  initialContext: {
    // Add your initial context here
  },
  
  steps: [
    // Simple agent step
    "agent:yoda-collector",
    "agent:yoda-greeter",
    
    // Simple script step
    "script:hello.js",
    
    // Example conditional (uncomment to use):
    // {
    //   if: (context, loop) => context.shouldRetry && loop.count < 3,
    //   true: { goto: -1 },  // Go back one step
    //   false: { goto: "agent:done" }  // Jump to named step
    // },
    
    // Example forEach (uncomment to use):
    // {
    //   forEach: (context) => context.items || [],
    //   as: "currentItem",
    //   parallel: false,
    //   steps: [
    //     "agent:process-item"
    //   ]
    // },
  ]
};
