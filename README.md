# agent-state-machine

A workflow runner for building **linear, stateful agent workflows** in plain JavaScript.

You write normal `async/await` code. The runtime handles:
- **Auto-persisted** `memory` (saved to disk on mutation)
- **Human-in-the-loop** blocking via `initialPrompt()` or agent-driven interactions
- Local **JS agents** + **Markdown agents** (LLM-powered)

---

## Install

```bash
npm i agent-state-machine
```

Global CLI:

```bash
npm i -g agent-state-machine
```

Requirements: Node.js >= 16.

---

## CLI

```bash
state-machine --setup <workflow-name>
state-machine run <workflow-name>
state-machine resume <workflow-name>
state-machine status <workflow-name>
state-machine history <workflow-name> [limit]
state-machine reset <workflow-name>
```

Workflows live in:

```text
workflows/<name>/
├── workflow.js        # Native JS workflow (async/await)
├── package.json       # Sets "type": "module" for this workflow folder
├── agents/            # Custom agents (.js/.mjs/.cjs or .md)
├── interactions/      # Human-in-the-loop files (auto-created)
├── state/             # current.json, history.jsonl, generated-prompt.md
└── steering/          # global.md + config.json
```

---

## Writing workflows (native JS)

```js
/**
/**
 * project-builder Workflow
 *
 * Native JavaScript workflow - write normal async/await code!
 *
 * Features:
 * - memory object auto-persists to disk (use memory guards for idempotency)
 * - Use standard JS control flow (if, for, etc.)
 * - Interactive prompts pause and wait for user input
 */

import { agent, memory, initialPrompt, parallel } from 'agent-state-machine';
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
  console.log('Starting project-builder workflow...');

  // Example: Get user input (saved to memory)
  const answer = await initialPrompt('Where do you live?');
  console.log('Example prompt answer:', answer);

  const userInfo = await agent('yoda-name-collector');
  memory.userInfo = userInfo;

  // Provide context
  // const userInfo = await agent('yoda-name-collector', { name: 'Luke' });

  console.log('Example agent memory.userInfo:', memory.userInfo || userInfo);

  // Context is provided automatically
  const { greeting } = await agent('yoda-greeter');
  console.log('Example agent greeting:', greeting);

  // Or you can provide context manually
  // await agent('yoda-greeter', userInfo);

  // Example: Parallel execution
  // const [a, b] = await parallel([
  //   agent('example', { which: 'a' }),
  //   agent('example', { which: 'b' })
  // ]);

  notify(['project-builder', userInfo.name || userInfo + ' has been greeted!']);

  console.log('Workflow completed!');
}
```

### How “resume” works

`resume` restarts your workflow from the top. 

If the workflow needs human input, it will **block inline** in the terminal. You’ll be told which `interactions/<slug>.md` file to edit; after you fill it in, press `y` in the same terminal session to continue.

If the process is interrupted, running `state-machine resume <workflow-name>` will restart the execution. Use the `memory` object to store and skip work manually if needed.

---

## Core API

### `agent(name, params?)`

Runs `workflows/<name>/agents/<agent>.(js|mjs|cjs)` or `<agent>.md`.

```js
const out = await agent('review', { file: 'src/app.js' });
memory.lastReview = out;
```

### `memory`

A persisted object for your workflow.

- Mutations auto-save to `workflows/<name>/state/current.json`.
- Use it as your “long-lived state” between runs.

```js
memory.count = (memory.count || 0) + 1;
```

### `initialPrompt(question, options?)`

Gets user input.

- In a TTY, it prompts in the terminal.
- Otherwise it creates `interactions/<slug>.md` and blocks until you confirm in the terminal.

```js
const repo = await initialPrompt('What repo should I work on?', { slug: 'repo' });
memory.repo = repo;
```

### `parallel([...])` / `parallelLimit([...], limit)`

Run multiple `agent()` calls concurrently:

```js
import { agent, parallel, parallelLimit } from 'agent-state-machine';

const [a, b] = await parallel([
  agent('review', { file: 'src/a.js' }),
  agent('review', { file: 'src/b.js' }),
]);

const results = await parallelLimit(
  ['a.js', 'b.js', 'c.js'].map(f => agent('review', { file: f })),
  2
);
```

---

## Agents

Agents live in `workflows/<workflow>/agents/`.

### JavaScript agents

**ESM (`.js` / `.mjs`)**:

```js
// workflows/<name>/agents/example.js
import { llm } from 'agent-state-machine';

export default async function handler(context) {
  // context includes:
  // - persisted memory (spread into the object)
  // - params passed to agent(name, params)
  // - context._steering (global steering prompt/config)
  // - context._config (models/apiKeys/workflowDir)
  return { ok: true };
}
```

**CommonJS (`.cjs`)** (only if you prefer CJS):

```js
// workflows/<name>/agents/example.cjs
async function handler(context) {
  return { ok: true };
}

module.exports = handler;
module.exports.handler = handler;
```

If you need to request human input from a JS agent, return an `_interaction` payload:

```js
return {
  _interaction: {
    slug: 'approval',
    targetKey: 'approval',
    content: 'Please approve this change (yes/no).'
  }
};
```

The runtime will block execution and wait for your response in the terminal.

### Markdown agents (`.md`)

Markdown agents are LLM-backed prompt templates with optional frontmatter.

```md
---
model: smart
output: greeting
---
Generate a friendly greeting for {{name}}.
```

Calling it:

```js
const { greeting } = await agent('greeter', { name: 'Sam' });
memory.greeting = greeting;
```

---

## Models & LLM execution

In your workflow’s `export const config = { models: { ... } }`, each model value can be:

### CLI command

```js
export const config = {
  models: {
    smart: "claude -m claude-sonnet-4-20250514 -p"
  }
};
```

### API target

Format: `api:<provider>:<model>`

```js
export const config = {
  models: {
    smart: "api:openai:gpt-4.1-mini"
  },
  apiKeys: {
    openai: process.env.OPENAI_API_KEY
  }
};
```

The runtime writes the fully-built prompt to:

```text
workflows/<name>/state/generated-prompt.md
```

---

## State & persistence

Native JS workflows persist to:

- `workflows/<name>/state/current.json` — status, memory, pending interaction
- `workflows/<name>/state/history.jsonl` — event log (newest entries first)
- `workflows/<name>/interactions/*.md` — human input files (when paused)

## License

MIT
