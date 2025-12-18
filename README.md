# agent-state-machine

A workflow runner for building **resumable, idempotent agent workflows** in plain JavaScript.

You write normal `async/await` code. The runtime handles:
- **Cached** `agent()` calls (safe to re-run / resume)
- **Auto-persisted** `memory` (saved to disk on mutation)
- **Human-in-the-loop** pauses via `initialPrompt()` or agent-driven interactions
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
 * project-builder Workflow
 *
 * Native JavaScript workflow - write normal async/await code!
 *
 * Features:
 * - agent() calls are automatically cached for resume/idempotency
 * - memory object auto-persists to disk
 * - Use standard JS control flow (if, for, etc.)
 */

import { agent, memory, initialPrompt, parallel } from 'agent-state-machine';

export const config = {
  models: {
    fast: "claude -p",
    smart: "claude -m claude-sonnet-4-20250514 -p",
    genius: "claude -m claude-opus-4-20250514 -p",
  }
};

export default async function() {
  const name = await initialPrompt('What is your name?');
  memory.userName = name;

  const result = await agent('example', { name });
  memory.lastResult = result;

  const [a, b] = await parallel([
    agent('example', { which: 'a' }),
    agent('example', { which: 'b' })
  ]);

  console.log(a, b);
}
```

### How “resume” works

`resume` simply **re-runs your workflow**. Because `agent()` and `initialPrompt()` are cached, already-completed work is skipped automatically.

If the workflow paused for input, you’ll be told which `interactions/<slug>.md` file to edit; after you fill it in, run:

```bash
state-machine resume <workflow-name>
```

---

## Core API

### `agent(name, params?)`

Runs `workflows/<name>/agents/<agent>.(js|mjs|cjs)` or `<agent>.md`.

- Results are cached automatically (by agent name + params).
- If it’s cached, the result is returned immediately on re-run.

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

Gets user input with caching.

- In a TTY, it prompts in the terminal.
- Otherwise it creates `interactions/<slug>.md` and pauses the workflow.

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

If you need to pause for human input from a JS agent, return an `_interaction` payload:

```js
return {
  _interaction: {
    slug: 'approval',
    targetKey: '_interaction_approval',
    content: 'Please approve this change (yes/no).'
  }
};
```

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
