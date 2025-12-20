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
    path.join(workflowDir, 'steering'),
    path.join(workflowDir, 'scripts')
  ];

  dirs.forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  Created: ${path.relative(process.cwd(), dir)}/`);
  });

  // Ensure this workflow folder is ESM (so workflow.js + agents/*.js can use import/export)
  // const workflowPkg = {
  //   name: `workflow-${workflowName}`,
  //   private: true,
  //   type: 'module'
  // };
  // const workflowPkgFile = path.join(workflowDir, 'package.json');
  // fs.writeFileSync(workflowPkgFile, JSON.stringify(workflowPkg, null, 2));
  // console.log(`  Created: ${path.relative(process.cwd(), workflowPkgFile)}`);

  // Create workflow.js (native JS format)
  const workflowJs = `/**
/**
 * ${workflowName} Workflow
 *
 * Native JavaScript workflow - write normal async/await code!
 *
 * Features:
 * - memory object auto-persists to disk (use memory guards for idempotency)
 * - Use standard JS control flow (if, for, etc.)
 * - Interactive prompts pause and wait for user input
 */

import { agent, memory, askHuman, parallel } from 'agent-state-machine';
import { notify } from './scripts/mac-notification.js';

// Model configuration (also supports models in a separate config export)
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

export default async function() {
  console.log('Starting ${workflowName} workflow...');

  // Example: Get user input (saved to memory)
  const userLocation = await askHuman('Where do you live?');
  console.log('Example prompt answer:', userLocation);

  const userInfo = await agent('yoda-name-collector');
  memory.userInfo = userInfo;

  // Provide context
  // const userInfo = await agent('yoda-name-collector', { name: 'Luke' });

  console.log('Example agent memory.userInfo:', memory.userInfo || userInfo);

  // Context is provided automatically
  const { greeting } = await agent('yoda-greeter', { userLocation });
  console.log('Example agent greeting:', greeting);

  // Or you can provide context manually
  // await agent('yoda-greeter', userInfo);

  // Example: Parallel execution
  // const [a, b, c] = await parallel([
  //   agent('yoda-greeter', { name: 'the names augustus but friends call me gus' }),
  //   agent('yoda-greeter', { name: 'uriah' }),
  //   agent('yoda-greeter', { name: 'lucas' })
  // ]);

  // console.log('a: ' + JSON.stringify(a))
  // console.log('b: ' + JSON.stringify(b))
  // console.log('c: ' + JSON.stringify(c))

  notify(['${workflowName}', userInfo.name || userInfo + ' has been greeted!']);

  console.log('Workflow completed!');
}
`;

  const workflowFile = path.join(workflowDir, 'workflow.js');
  fs.writeFileSync(workflowFile, workflowJs);
  console.log(`  Created: ${path.relative(process.cwd(), workflowFile)}`);

  // Create example JS agent (ESM)
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
  const yodaGreeterAgent = `---
model: low
output: greeting
---

# Greeting Task

Generate a friendly greeting for {{name}} from {{location}} in a yoda style. Prompt user for their actual {{name}} if you dont have it.

Once you have it create a yoda-greeting.md file in root dir with the greeting.

You are a fast, direct worker. Do NOT investigate the codebase or read files unless strictly necessary. Perform the requested action immediately using the provided context. Avoid "thinking" steps or creating plans if the task is simple.
`;

  const yodaNameCollectorAgent = `---
model: low
output: name
---

# Name Collection Task

Ask for users name in a yoda style. Unless you have it already.

Keep it brief and warm.

You are a fast, direct worker. Do NOT investigate the codebase or read files unless strictly necessary. Perform the requested action immediately using the provided context. Avoid "thinking" steps or creating plans if the task is simple.
`;

  const yodaNameCollectorAgentFile = path.join(workflowDir, 'agents', 'yoda-name-collector.md');
  fs.writeFileSync(yodaNameCollectorAgentFile, yodaNameCollectorAgent);

  const yodaGreeterFile = path.join(workflowDir, 'agents', 'yoda-greeter.md');
  fs.writeFileSync(yodaGreeterFile, yodaGreeterAgent);

  console.log(`  Created: ${path.relative(process.cwd(), yodaGreeterFile)}`);
  console.log(`  Created: ${path.relative(process.cwd(), yodaNameCollectorAgentFile)}`);

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

## Helpful Tips
- Scripts live in /workflows/project-builder/scripts/
- .gitignore includes /workflows so include ignored files when searching for a script and use \`search_file_content\` with the \`no_ignore\` flag to read the contents of script files.
- Shell execution via \`run_shell_command\` is unavailable, so reproduce the script's intended side effect to fulfill the task.

## Notes

This file is automatically loaded and passed to every agent in the workflow via \`context._steering.global\`.
`;
  const globalMdFile = path.join(workflowDir, 'steering', 'global.md');
  fs.writeFileSync(globalMdFile, globalMd);
  console.log(`  Created: ${path.relative(process.cwd(), globalMdFile)}`);

  // Create mac-notification.js script
  const macNotificationScript = `"use strict";

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function escAppleScript(s) {
  return String(s).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"');
}

function notify(title = "Notification", message = "Everything finished!") {
  const script = \`display notification "\${escAppleScript(message)}" with title "\${escAppleScript(title)}"\`;
  spawnSync("osascript", ["-e", script], { stdio: "ignore" });

  const soundPath = "/System/Library/Sounds/Glass.aiff";
  const fallbackPath = "/System/Library/Sounds/Ping.aiff";

  if (existsSync(soundPath)) {
    spawnSync("afplay", [soundPath], { stdio: "ignore" });
  } else if (existsSync(fallbackPath)) {
    spawnSync("afplay", [fallbackPath], { stdio: "ignore" });
  }
}

export { notify };
`;
  const notificationFile = path.join(workflowDir, 'scripts', 'mac-notification.js');
  fs.writeFileSync(notificationFile, macNotificationScript);
  console.log(`  Created: ${path.relative(process.cwd(), notificationFile)}`);

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

Run the workflow (or resume if interrupted):
\\\`\\\`\\\`bash
state-machine run ${workflowName}
\\\`\\\`\\\`

Check status:
\\\`\\\`\\\`bash
state-machine status ${workflowName}
\\\`\\\`\\\`

View history:
\\\`\\\`\\\`bash
state-machine history ${workflowName}
\\\`\\\`\\\`

View trace logs in browser with live updates:
\\\`\\\`\\\`bash
state-machine follow ${workflowName}
\\\`\\\`\\\`

Reset state (clears memory/state):
\\\`\\\`\\\`bash
state-machine reset ${workflowName}
\\\`\\\`\\\`

Hard reset (clears everything: history/interactions/memory):
\\\`\\\`\\\`bash
state-machine reset-hard ${workflowName}
\\\`\\\`\\\`

## Writing Workflows

Edit \`workflow.js\` - write normal async JavaScript:

\\\`\\\`\\\`js
import { agent, memory, askHuman, parallel } from 'agent-state-machine';

export default async function() {
  console.log('Starting project-builder workflow...');

  // Example: Get user input (saved to memory)
  const userLocation = await askHuman('Where do you live?');
  console.log('Example prompt answer:', userLocation);

  const userInfo = await agent('yoda-name-collector');
  memory.userInfo = userInfo;

  // Provide context
  // const userInfo = await agent('yoda-name-collector', { name: 'Luke' });

  console.log('Example agent memory.userInfo:', memory.userInfo || userInfo);

  // Context is provided automatically
  const { greeting } = await agent('yoda-greeter', { userLocation });
  console.log('Example agent greeting:', greeting);

  // Or you can provide context manually
  // await agent('yoda-greeter', userInfo);

  // Example: Parallel execution
  // const [a, b, c] = await parallel([
  //   agent('yoda-greeter', { name: 'the names augustus but friends call me gus' }),
  //   agent('yoda-greeter', { name: 'uriah' }),
  //   agent('yoda-greeter', { name: 'lucas' })
  // ]);

  // console.log('a: ' + JSON.stringify(a))
  // console.log('b: ' + JSON.stringify(b))
  // console.log('c: ' + JSON.stringify(c))

  notify(['project-builder', userInfo.name || userInfo + ' has been greeted!']);

  console.log('Workflow completed!');
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
