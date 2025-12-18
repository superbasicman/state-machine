````md
# CLAUDE.md

Instructions for Claude Code (claude.ai/code) when editing this repository.

## What this repo is

Agent State Machine is a **native JavaScript workflow runner**.

You write a workflow as normal `async/await` JavaScript, and the runtime provides:
- `agent(name, params?)` with **automatic caching** (safe to re-run / resume)
- `memory` that **persists to disk** on mutation
- Human-in-the-loop pausing through `initialPrompt()` and agent-driven interactions
- Agents implemented as **JS modules** or **Markdown prompt templates**
- LLM calls via local CLI tools or provider APIs

There is **no legacy DSL workflow engine** (no step arrays, goto/forEach constructs, etc.). Control flow is standard JavaScript (`if`, `for`, functions, etc.).

---

## CLI commands

```bash
# Scaffold a new workflow folder
state-machine --setup <workflow-name>

# Run a workflow from the top (idempotent due to caching)
state-machine run <workflow-name>

# Resume by re-running (cached calls are skipped)
state-machine resume <workflow-name>

# Inspect / debug
state-machine status <workflow-name>
state-machine history <workflow-name> [limit]
state-machine reset <workflow-name>

# List all workflows under ./workflows
state-machine list
```

For local development, `npm link` is the simplest way to use the CLI globally.

---

## Repository layout

### Key files

- `bin/cli.js`
  - CLI entrypoint. Loads `workflow.js` and runs it through the runtime.
- `lib/runtime/runtime.js`
  - `WorkflowRuntime` that loads state, executes workflows, persists state/history, and handles pause/resume.
- `lib/runtime/agent.js`
  - Implements `agent()` caching and agent execution for:
    - JS agents (`.js` / `.mjs` / `.cjs`)
    - Markdown agents (`.md`)
- `lib/llm.js`
  - LLM adapter supporting:
    - CLI invocations (e.g. `claude -p`)
    - API targets using `api:<provider>:<model>` with keys from workflow config
  - Writes the assembled prompt to `state/generated-prompt.md`.
- `lib/index.js`
  - Public exports used by workflows and agents (`agent`, `memory`, `initialPrompt`, `parallel`, `llm`, etc.).

### Workflow folder layout (created by `--setup`)

```text
workflows/<name>/
├── workflow.js        # Native JS workflow (async/await)
├── package.json       # Sets "type": "module" for this workflow folder
├── agents/            # JS agents and Markdown agents
├── interactions/      # Human input files (created when paused)
├── state/             # current.json, history.jsonl, generated-prompt.md
└── steering/          # global.md and config.json
```

---

## How workflows are written

Workflows are plain JS modules that export a default async function:

```js
import { agent, memory, initialPrompt, parallel } from 'agent-state-machine';

export const config = {
  models: {
    fast: "claude -p",
    smart: "api:openai:gpt-4.1-mini"
  },
  apiKeys: {
    openai: process.env.OPENAI_API_KEY
  }
};

export default async function () {
  const topic = await initialPrompt('What should we work on?', { slug: 'topic' });
  memory.topic = topic;

  const result = await agent('research', { topic });
  memory.research = result;

  const [a, b] = await parallel([
    agent('summarize', { topic, mode: 'short' }),
    agent('summarize', { topic, mode: 'long' }),
  ]);

  memory.outputs = { a, b };
}
```

### Resume model

“Resume” re-runs the workflow from the beginning. Previously completed work is skipped because:
- `agent()` results are cached by `(agent name + params)`
- `initialPrompt()` is cached once answered

This keeps workflows simple: write them once, rerun as many times as needed.

---

## Agents

Agents are loaded from `workflows/<name>/agents/`.

### JavaScript agents

Supported extensions: `.js`, `.mjs`, `.cjs`

An ESM agent typically exports `default`:

```js
import { llm } from 'agent-state-machine';

export default async function (context) {
  // context contains:
  // - persisted memory keys (spread into the object)
  // - params passed to agent(name, params)
  // - context._steering.global (if enabled)
  // - context._config (models, apiKeys, workflowDir)
  const resp = await llm(context, { model: 'fast', prompt: 'Say hello.' });
  return { text: resp.text };
}
```

### Markdown agents

Markdown agents are prompt templates with optional frontmatter:

```md
---
model: fast
output: greeting
format: text
includeContext: true
---

Write a greeting for {{name}}.
```

Calling it:

```js
const { greeting } = await agent('greeter', { name: 'Sam' });
```

Supported frontmatter knobs (non-exhaustive, based on current implementation):
- `model`: model alias from workflow config
- `output`: key to place the result under
- `format`: `json` (attempt parse) or `interaction` (forces pause)
- `includeContext`: `"false"` to omit extra context in the prompt build
- `interaction`: `"true"` or a string slug to request human input
- `interactionKey`: where the human answer is stored in `memory`
- `autoInteract`: `"false"` to disable auto-detection of interaction blocks in LLM output

---

## Human-in-the-loop interactions

Two ways a run can pause:

1) `initialPrompt(...)`
- In a non-interactive environment it creates an `interactions/<slug>.md` file and pauses.

2) A JS agent returns an interaction request:

```js
return {
  _interaction: {
    slug: 'approval',
    targetKey: 'approval',
    content: 'Approve this change? (yes/no)'
  }
};
```

When paused, the runtime records `_pendingInteraction` in `state/current.json`. Fill in the interaction file, then run `state-machine resume <workflow>`.

---

## State & persistence

Per workflow, persisted files live under `workflows/<name>/state/`:

- `current.json`
  - `memory`: persisted workflow memory
  - `_cache`: cached results for `agent()` and other cached helpers
  - `status`: `IDLE | RUNNING | PAUSED | FAILED | COMPLETED`
  - `_pendingInteraction`: set when waiting for a human response
- `history.jsonl`
  - event log, newest entries prepended
- `generated-prompt.md`
  - latest assembled prompt used by `llm()`

---

## LLM configuration

Models are defined in `workflow.js` under `export const config`:

### CLI model

```js
export const config = {
  models: { fast: "claude -p" }
};
```

### API model

Use the format `api:<provider>:<model>` and provide a matching key in `apiKeys`:

```js
export const config = {
  models: { smart: "api:openai:gpt-4.1-mini" },
  apiKeys: { openai: process.env.OPENAI_API_KEY }
};
```

`llm()` writes the final prompt to `state/generated-prompt.md` before executing the CLI or API call.

---
````
