# agent-state-machine

A workflow runner for building **linear, stateful agent workflows** in plain JavaScript.

You write normal `async/await` code. The runtime handles:
- **Auto-persisted** `memory` (saved to disk on mutation)
- **Human-in-the-loop** blocking via `askHuman()` or agent-driven interactions
- Local **JS agents** + **Markdown agents** (LLM-powered)

---

## Install

You need to install the package **globally** to get the CLI, and **locally** in your project so your workflow can import the library.

### Global CLI
Provides the `state-machine` command.

```bash
# npm
npm i -g agent-state-machine

# pnpm
pnpm add -g agent-state-machine
```

### Local Library
Required so your `workflow.js` can `import { agent, memory } from 'agent-state-machine'`.

```bash
# npm
npm i agent-state-machine

# pnpm (for monorepos/turbo, install in root)
pnpm add agent-state-machine -w
```

Requirements: Node.js >= 16.

---

## CLI

```bash
state-machine --setup <workflow-name>
state-machine run <workflow-name>
state-machine run <workflow-name> -reset
state-machine run <workflow-name> -reset-hard


state-machine history <workflow-name> [limit]
```

Workflows live in:

```text
workflows/<name>/
├── workflow.js        # Native JS workflow (async/await)
├── config.js          # Model/API key configuration
├── package.json       # Sets "type": "module" for this workflow folder
├── agents/            # Custom agents (.js/.mjs/.cjs or .md)
├── interactions/      # Human-in-the-loop files (auto-created)
├── state/             # current.json, history.jsonl
└── steering/          # global.md + config.json
```

---

## Writing workflows (native JS)

Edit `config.js` to set models and API keys for the workflow.

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

import { agent, memory, askHuman, parallel } from 'agent-state-machine';
import { notify } from './scripts/mac-notification.js';

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
```

### Resuming workflows

`state-machine run` restarts your workflow from the top, loading the persisted state.

If the workflow needs human input, it will **block inline** in the terminal. You can answer in the terminal, edit `interactions/<slug>.md`, or respond in the browser.

If the process is interrupted, running `state-machine run <workflow-name>` again will continue execution (assuming your workflow uses `memory` to skip completed steps).

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

### `askHuman(question, options?)`

Gets user input.

- In a TTY, it prompts in the terminal (or via the browser when remote follow is enabled).
- Otherwise it creates `interactions/<slug>.md` and blocks until you confirm in the terminal (or respond in the browser).

```js
const repo = await askHuman('What repo should I work on?', { slug: 'repo' });
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

The runtime captures the fully-built prompt in `state/history.jsonl`, viewable in the browser with live updates when running with the `--local` flag or via the remote URL. Remote follow links persist across runs (stored in `config.js`) unless you pass `-n`/`--new` to regenerate.

---

## State & persistence

Native JS workflows persist to:

- `workflows/<name>/state/current.json` — status, memory, pending interaction
- `workflows/<name>/state/history.jsonl` — event log (newest entries first)
- `workflows/<name>/interactions/*.md` — human input files (when paused)

## License

MIT
