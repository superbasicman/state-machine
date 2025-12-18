# es-workflow

A workflow created with agent-state-machine (native JS format).

## Structure

```
es-workflow/
├── workflow.js      # Native JS workflow (async/await)
├── agents/          # Custom agent modules (.js or .md)
├── scripts/         # Executable scripts
├── state/           # Runtime state (current.json, history.jsonl)
└── steering/        # Steering configuration
```

## Usage

Run the workflow:
```bash
state-machine run es-workflow
```

Resume after pause/failure (cached agent calls are skipped):
```bash
state-machine resume es-workflow
```

Check status:
```bash
state-machine status es-workflow
```

View history:
```bash
state-machine history es-workflow
```

Reset state (clears cache):
```bash
state-machine reset es-workflow
```

## Writing Workflows

Edit `workflow.js` - write normal async JavaScript:

```javascript
import { agent, memory, initialPrompt, parallel } from 'agent-state-machine';

export default async function() {
  // Get user input
  const name = await initialPrompt('What is your name?');

  // Call agents (auto-cached for resume)
  const result = await agent('my-agent', { name });

  // Store in memory (auto-persists)
  memory.result = result;

  // Use normal JS control flow
  for (const item of result.items) {
    await agent('process', { item });
  }

  // Run agents in parallel
  const [a, b] = await parallel([
    agent('task-a'),
    agent('task-b')
  ]);
}
```

## Creating Agents

**JavaScript agents** (`agents/my-agent.js`):
```javascript
async function handler(context) {
  // Access params passed to agent()
  const { name } = context;

  // Use LLM
  const { llm } = require('agent-state-machine');
  const response = await llm(context, {
    model: 'smart',
    prompt: `Hello ${name}`
  });

  return { greeting: response.text };
}
module.exports = handler;
```

**Markdown agents** (`agents/greeter.md`):
```markdown
---
model: fast
output: greeting
---
Generate a greeting for {{name}}.
```
