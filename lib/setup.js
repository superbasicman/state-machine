const fs = require('fs');
const path = require('path');

/**
 * Setup a new workflow with directory structure
 */
async function setup(workflowName) {
  const workflowsDir = path.join(process.cwd(), 'workflows');
  const workflowDir = path.join(workflowsDir, workflowName);

  // Check if workflow already exists
  if (fs.existsSync(workflowDir)) {
    console.error(`Error: Workflow '${workflowName}' already exists at ${workflowDir}`);
    process.exit(1);
  }

  console.log(`\nCreating workflow: ${workflowName}`);
  console.log('─'.repeat(40));

  // Create directory structure
  const dirs = [
    workflowDir,
    path.join(workflowDir, 'agents'),
    path.join(workflowDir, 'scripts'),
    path.join(workflowDir, 'interactions'),
    path.join(workflowDir, 'state'),
    path.join(workflowDir, 'steering')
  ];

  dirs.forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  Created: ${path.relative(process.cwd(), dir)}/`);
  });

  // Create workflow.js
  const workflowJs = `/**
 * ${workflowName} Workflow
 * 
 * Define your workflow steps here. Steps can be:
 * - String: "agent:name" or "script:file.js"
 * - Conditional: { if: (context, loop) => condition, true: { goto }, false: { goto } }
 * - Loop: { forEach: (context) => array, as: "itemName", steps: [...], parallel: false }
 */

module.exports = {
  name: "${workflowName}",
  description: "${workflowName} workflow",
  version: "1.0.0",
  
  // Define your models here - use any key name you want
  // CLI commands: just the command to run
  // API calls: "api:provider:model-name"
  models: {
    fast: "claude -p",                              // Claude CLI (fast, printing mode)
    smart: "claude -m claude-sonnet-4-20250514 -p",   // Claude Sonnet
    genius: "claude -m claude-opus-4-20250514 -p",    // Claude Opus
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
    "agent:example",
    
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
`;
  const workflowFile = path.join(workflowDir, 'workflow.js');
  fs.writeFileSync(workflowFile, workflowJs);
  console.log(`  Created: ${path.relative(process.cwd(), workflowFile)}`);

  // Create example agent
  const exampleAgent = `/**
 * Example Agent for ${workflowName}
 * 
 * Agents are async functions that receive context and return updated context.
 * 
 * To use LLM capabilities:
 *   const { llm, llmText, llmJSON } = require('agent-state-machine');
 *   const response = await llm(context, { model: 'smart', prompt: 'Your prompt' });
 */

// Uncomment to use LLM:
// const { llm, llmText } = require('agent-state-machine');

async function handler(context) {
  console.log('[Agent: example] Processing context...');
  
  // Access global steering prompt if available
  if (context._steering?.global) {
    console.log('[Agent: example] Steering prompt loaded (' + context._steering.global.length + ' chars)');
  }
  
  // Example: Call an LLM (uncomment and configure models in workflow.js)
  // const response = await llm(context, {
  //   model: 'smart',  // References models.smart in workflow.js
  //   prompt: 'Say hello and describe what you can help with.'
  // });
  // console.log('[Agent: example] LLM response:', response.text);
  
  return {
    ...context,
    exampleProcessed: true,
    processedAt: new Date().toISOString()
  };
}

module.exports = handler;
module.exports.handler = handler;

// Optional metadata
module.exports.meta = {
  name: 'example',
  description: 'An example agent to get you started',
  version: '1.0.0'
};
`;
  const agentFile = path.join(workflowDir, 'agents', 'example.js');
  fs.writeFileSync(agentFile, exampleAgent);
  console.log(`  Created: ${path.relative(process.cwd(), agentFile)}`);

  // Create example markdown agent
  const exampleMdAgent = `---
model: fast
output: greeting
---

# Greeting Task

Generate a friendly greeting for {{name}}.

Keep it brief and warm.
`;
  const mdAgentFile = path.join(workflowDir, 'agents', 'greeter.md');
  fs.writeFileSync(mdAgentFile, exampleMdAgent);
  console.log(`  Created: ${path.relative(process.cwd(), mdAgentFile)}`);

  // Create example script
  const exampleScript = `#!/usr/bin/env node

/**
 * Example Script for ${workflowName}
 * 
 * Scripts receive context via the AGENT_CONTEXT environment variable.
 * Global steering prompt is available via AGENT_STEERING env var.
 * Output JSON on the last line to update the workflow context.
 */

// Get context from environment
const context = JSON.parse(process.env.AGENT_CONTEXT || '{}');
const steering = process.env.AGENT_STEERING || '';

console.log('[Script: hello] Hello from the script!');
console.log('[Script: hello] Received context keys:', Object.keys(context).filter(k => !k.startsWith('_')));

if (steering) {
  console.log('[Script: hello] Steering prompt loaded (' + steering.length + ' chars)');
}

// Do your processing here...

// Output result as JSON on the last line (this updates the workflow context)
const result = {
  scriptExecuted: true,
  greeting: 'Hello from ${workflowName}!',
  timestamp: new Date().toISOString()
};

console.log(JSON.stringify(result));
`;
  const scriptFile = path.join(workflowDir, 'scripts', 'hello.js');
  fs.writeFileSync(scriptFile, exampleScript);
  console.log(`  Created: ${path.relative(process.cwd(), scriptFile)}`);

  // Create initial state
  const initialState = {
    status: 'IDLE',
    workflow: null,
    currentStepIndex: 0,
    context: {},
    startedAt: null,
    lastUpdatedAt: new Date().toISOString(),
    error: null
  };
  const stateFile = path.join(workflowDir, 'state', 'current.json');
  fs.writeFileSync(stateFile, JSON.stringify(initialState, null, 2));
  console.log(`  Created: ${path.relative(process.cwd(), stateFile)}`);

  // Create empty history file
  const historyFile = path.join(workflowDir, 'state', 'history.jsonl');
  fs.writeFileSync(historyFile, '');
  console.log(`  Created: ${path.relative(process.cwd(), historyFile)}`);

  // Create steering config
  const steeringConfig = {
    _comment: 'Steering configuration',
    enabled: true,
    globalPrompt: 'global.md'
  };
  const steeringFile = path.join(workflowDir, 'steering', 'config.json');
  fs.writeFileSync(steeringFile, JSON.stringify(steeringConfig, null, 2));
  console.log(`  Created: ${path.relative(process.cwd(), steeringFile)}`);

  // Create global.md steering prompt
  const globalMd = `# Global Steering Prompt

This content is included with every agent execution in the ${workflowName} workflow.

## Context

You are part of the "${workflowName}" workflow. Follow these guidelines:

- Process data carefully and validate inputs
- Return well-structured JSON when applicable
- Log meaningful progress messages
- Handle errors gracefully

## Variables

You have access to the workflow context which contains data from previous steps.

## Guidelines

Add your global instructions, constraints, or personas here. This file is automatically
loaded and passed to every agent in the workflow via \`context._steering.global\`.
`;
  const globalMdFile = path.join(workflowDir, 'steering', 'global.md');
  fs.writeFileSync(globalMdFile, globalMd);
  console.log(`  Created: ${path.relative(process.cwd(), globalMdFile)}`);

  // Create README
  const readme = `# ${workflowName}

A workflow created with agent-state-machine.

## Structure

\`\`\`
${workflowName}/
├── workflow.js    # Workflow definition and steps
├── agents/          # Custom agent modules
├── scripts/         # Executable scripts
├── state/           # Runtime state (current.json, history.jsonl)
└── steering/        # Steering configuration (future)
\`\`\`

## Usage

Run the workflow:
\`\`\`bash
state-machine run ${workflowName}
\`\`\`

Check status:
\`\`\`bash
state-machine status ${workflowName}
\`\`\`

View history:
\`\`\`bash
state-machine history ${workflowName}
\`\`\`

Reset state:
\`\`\`bash
state-machine reset ${workflowName}
\`\`\`

## Adding Steps

Edit \`workflow.js\` to add steps:

\`\`\`json
{
  "steps": [
    "agent:example",      // Runs agents/example.js
    "script:hello.js",    // Runs scripts/hello.js
    "agent:my-agent",     // Add your own agents
    "script:process.js"   // Add your own scripts
  ]
}
\`\`\`

## Creating Agents

Create a new file in \`agents/\`:

\`\`\`javascript
async function handler(context) {
  // Process context
  return { ...context, myData: 'value' };
}
module.exports = handler;
\`\`\`

## Creating Scripts

Create a new file in \`scripts/\`:

\`\`\`javascript
const context = JSON.parse(process.env.AGENT_CONTEXT || '{}');
// Process...
console.log(JSON.stringify({ result: 'data' }));
\`\`\`
`;
  const readmeFile = path.join(workflowDir, 'README.md');
  fs.writeFileSync(readmeFile, readme);
  console.log(`  Created: ${path.relative(process.cwd(), readmeFile)}`);

  console.log('─'.repeat(40));
  console.log(`\n✓ Workflow '${workflowName}' created successfully!\n`);
  console.log('Next steps:');
  console.log(`  1. Edit workflows/${workflowName}/workflow.js to configure steps`);
  console.log(`  2. Add custom agents in workflows/${workflowName}/agents/`);
  console.log(`  3. Add custom scripts in workflows/${workflowName}/scripts/`);
  console.log(`  4. Run: state-machine run ${workflowName}\n`);
}

module.exports = { setup };
