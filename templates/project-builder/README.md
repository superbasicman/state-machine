# project-builder

A workflow created with agent-state-machine (native JS format).

## Structure

\`\`\`
project-builder/
├── workflow.js      # Native JS workflow (async/await)
├── config.js        # Model/API key configuration
├── package.json     # Sets "type": "module" for this workflow folder
├── agents/          # Custom agents (.js/.mjs/.cjs or .md)
├── interactions/    # Human-in-the-loop inputs (created at runtime)
├── state/           # Runtime state (current.json, history.jsonl)
└── steering/        # Steering configuration
\`\`\`

## Usage

Edit `config.js` to set models and API keys for this workflow.

Run the workflow (or resume if interrupted):
\`\`\`bash
state-machine run project-builder
\`\`\`

Check status:
\`\`\`bash
state-machine status project-builder
\`\`\`

View history:
\`\`\`bash
state-machine history project-builder
\`\`\`

View trace logs in browser with live updates:
\`\`\`bash
state-machine follow project-builder
\`\`\`

Reset state (clears memory/state):
\`\`\`bash
state-machine reset project-builder
\`\`\`

Hard reset (clears everything: history/interactions/memory):
\`\`\`bash
state-machine reset-hard project-builder
\`\`\`

## Writing Workflows

Edit `workflow.js` - write normal async JavaScript:

\`\`\`js
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
\`\`\`

## Creating Agents

**JavaScript agent** (`agents/my-agent.js`):

\`\`\`js
import { llm } from 'agent-state-machine';

export default async function handler(context) {
  const response = await llm(context, { model: 'smart', prompt: 'Hello!' });
  return { greeting: response.text };
}
\`\`\`

**Markdown agent** (`agents/greeter.md`):

\`\`\`md
---
model: fast
output: greeting
---
Generate a greeting for {{name}}.
\`\`\`
