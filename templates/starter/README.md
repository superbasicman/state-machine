# __WORKFLOW_NAME__

A workflow created with agent-state-machine (native JS format).

## Structure

```
__WORKFLOW_NAME__/
├── workflow.js      # Native JS workflow (async/await)
├── config.js        # Model/API key configuration
├── agents/          # Custom agents (.js/.mjs/.cjs or .md)
├── interactions/    # Human-in-the-loop inputs (created at runtime)
├── state/           # Runtime state (current.json, history.jsonl)
└── steering/        # Steering configuration
```

## Usage

Edit `config.js` to set models and API keys for this workflow.

Run the workflow (or resume if interrupted):
```bash
state-machine run __WORKFLOW_NAME__
```

Check status:
```bash
state-machine status __WORKFLOW_NAME__
```

View history:
```bash
state-machine history __WORKFLOW_NAME__
```

View trace logs in browser with live updates:
```bash
state-machine follow __WORKFLOW_NAME__
```

Reset state (clears memory/state):
```bash
state-machine reset __WORKFLOW_NAME__
```

Hard reset (clears everything: history/interactions/memory):
```bash
state-machine reset-hard __WORKFLOW_NAME__
```

## Writing Workflows

Edit `workflow.js` - write normal async JavaScript:

```js
import { agent, memory, askHuman, parallel } from 'agent-state-machine';

export default async function() {
  console.log('Starting __WORKFLOW_NAME__ workflow...');

  // Example: Get user input (saved to memory)
  const userLocation = await askHuman('Where do you live?');
  console.log('Example prompt answer:', userLocation);

  const userInfo = await agent('yoda-name-collector');
  memory.userInfo = userInfo;

  // Provide context
  // const userInfo = await agent('yoda-name-collector', { name: 'Luke' });

  console.log('Example agent memory.userInfo:', memory.userInfo || userInfo);

  // Context is explicit: pass what the agent needs
  const { greeting } = await agent('yoda-greeter', { userLocation, memory });
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

  notify(['__WORKFLOW_NAME__', userInfo.name || userInfo + ' has been greeted!']);

  console.log('Workflow completed!');
}
```

## Creating Agents

**JavaScript agent** (`agents/my-agent.js`):

```js
import { llm } from 'agent-state-machine';

export default async function handler(context) {
  const response = await llm(context, { model: 'smart', prompt: 'Hello!' });
  return { greeting: response.text };
}
```

**Markdown agent** (`agents/greeter.md`):

```md
---
model: fast
output: greeting
---
Generate a greeting for {{name}}.
```
