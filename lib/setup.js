/**
 * File: /lib/setup.js
 */

import fs from 'fs';
import path from 'path';

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

  // Create directory structure (native JS workflow only)
  const dirs = [
    workflowDir,
    path.join(workflowDir, 'agents'),
    path.join(workflowDir, 'interactions'),
    path.join(workflowDir, 'state'),
    path.join(workflowDir, 'steering')
  ];

  dirs.forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  Created: ${path.relative(process.cwd(), dir)}/`);
  });

  // Ensure this workflow folder is ESM (so workflow.js + agents/*.js can use import/export)
  const workflowPkg = {
    name: `workflow-${workflowName}`,
    private: true,
    type: 'module'
  };
  const workflowPkgFile = path.join(workflowDir, 'package.json');
  fs.writeFileSync(workflowPkgFile, JSON.stringify(workflowPkg, null, 2));
  console.log(`  Created: ${path.relative(process.cwd(), workflowPkgFile)}`);

  // Create workflow.js (native JS format)
  const workflowJs = `/**
 * ${workflowName} Workflow
 *
 * Native JavaScript workflow - write normal async/await code!
 *
 * Features:
 * - memory object auto-persists to disk (use memory guards for idempotency)
 * - Use standard JS control flow (if, for, etc.)
 * - Interactive prompts pause and wait for user input
 */

import { agent, memory, initialPrompt, parallel } from 'agent-state-machine';

// Model configuration (also supports models in a separate config export)
export const config = {
  models: {
    fast: "claude -p",
    smart: "claude -m claude-sonnet-4-20250514 -p",
    genius: "claude -m claude-opus-4-20250514 -p",
  }
};

export default async function() {
  console.log('Starting ${workflowName} workflow...');

  // Example: Get user input (saved to memory)
  // const name = await initialPrompt('What is your name?');
  // memory.userName = name;

  // Example: Call an agent
  const result = await agent('example');
  console.log('Example agent result:', result);

  // Example: Call markdown agent
  // const { greeting } = await agent('greeter', { name: memory.userName || 'Sam' });
  // memory.greeting = greeting;

  // Example: Parallel execution
  // const [a, b] = await parallel([
  //   agent('example', { which: 'a' }),
  //   agent('example', { which: 'b' })
  // ]);

  console.log('Workflow completed!');
}
`;
  const workflowFile = path.join(workflowDir, 'workflow.js');
  fs.writeFileSync(workflowFile, workflowJs);
  console.log(`  Created: ${path.relative(process.cwd(), workflowFile)}`);

  // Create example JS agent (ESM)
  const exampleAgent = `/**
 * Example Agent for ${workflowName}
 *
 * Agents are async functions that receive a context object and return a result.
 * - Context includes: persisted memory (spread), params, _steering, _config
 */

import { llm } from 'agent-state-machine';

export default async function handler(context) {
  console.log('[Agent: example] Processing...');

  // Access global steering prompt if available
  if (context._steering?.global) {
    console.log('[Agent: example] Steering loaded (' + context._steering.global.length + ' chars)');
  }

  // Example: Call an LLM (configure models in workflow.js)
  // const response = await llm(context, {
  //   model: 'smart',
  //   prompt: 'Say hello and describe what you can help with.'
  // });
  // console.log('[Agent: example] LLM response:', response.text);

  return {
    ok: true,
    received: Object.keys(context).filter((k) => !String(k).startsWith('_')),
    processedAt: new Date().toISOString()
  };
}

export const meta = {
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

  // Create initial state (native format)
  const initialState = {
    format: 'native',
    status: 'IDLE',
    memory: {},
    _pendingInteraction: null,
    _error: null,
    startedAt: null,
    lastUpdatedAt: new Date().toISOString()
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

## Guidelines

- Process data carefully and validate inputs
- Return well-structured JSON when applicable
- Log meaningful progress messages
- Handle errors gracefully

## Notes

This file is automatically loaded and passed to every agent in the workflow via \`context._steering.global\`.
`;
  const globalMdFile = path.join(workflowDir, 'steering', 'global.md');
  fs.writeFileSync(globalMdFile, globalMd);
  console.log(`  Created: ${path.relative(process.cwd(), globalMdFile)}`);

  // Create README
  const readme = `# ${workflowName}

A workflow created with agent-state-machine (native JS format).

## Structure

\\\`\\\`\\\`
${workflowName}/
├── workflow.js      # Native JS workflow (async/await)
├── package.json     # Sets "type": "module" for this workflow folder
├── agents/          # Custom agents (.js/.mjs/.cjs or .md)
├── interactions/    # Human-in-the-loop inputs (created at runtime)
├── state/           # Runtime state (current.json, history.jsonl)
└── steering/        # Steering configuration
\\\`\\\`\\\`

## Usage

Run the workflow:
\\\`\\\`\\\`bash
state-machine run ${workflowName}
\\\`\\\`\\\`

Resume a paused workflow:
\\\`\\\`\\\`bash
state-machine resume ${workflowName}
\\\`\\\`\\\`

Check status:
\\\`\\\`\\\`bash
state-machine status ${workflowName}
\\\`\\\`\\\`

View history:
\\\`\\\`\\\`bash
state-machine history ${workflowName}
\\\`\\\`\\\`

Reset state:
\\\`\\\`\\\`bash
state-machine reset ${workflowName}
\\\`\\\`\\\`

## Writing Workflows

Edit \`workflow.js\` - write normal async JavaScript:

\\\`\\\`\\\`js
import { agent, memory, initialPrompt, parallel } from 'agent-state-machine';

export default async function() {
  const name = await initialPrompt('What is your name?');
  memory.userName = name;

  const result = await agent('example', { name });
  memory.result = result;

  const [a, b] = await parallel([
    agent('example', { which: 'a' }),
    agent('example', { which: 'b' })
  ]);
}
\\\`\\\`\\\`

## Creating Agents

**JavaScript agent** (\`agents/my-agent.js\`):

\\\`\\\`\\\`js
import { llm } from 'agent-state-machine';

export default async function handler(context) {
  const response = await llm(context, { model: 'smart', prompt: 'Hello!' });
  return { greeting: response.text };
}
\\\`\\\`\\\`

**Markdown agent** (\`agents/greeter.md\`):

\\\`\\\`\\\`md
---
model: fast
output: greeting
---
Generate a greeting for {{name}}.
\\\`\\\`\\\`
`;
  const readmeFile = path.join(workflowDir, 'README.md');
  fs.writeFileSync(readmeFile, readme);
  console.log(`  Created: ${path.relative(process.cwd(), readmeFile)}`);

  console.log('─'.repeat(40));
  console.log(`\n✓ Workflow '${workflowName}' created successfully!\n`);
  console.log('Next steps:');
  console.log(`  1. Edit workflows/${workflowName}/workflow.js to implement your flow`);
  console.log(`  2. Add custom agents in workflows/${workflowName}/agents/`);
  console.log(`  3. Run: state-machine run ${workflowName}\n`);
}

export { setup };
