````md
# CLAUDE.md

Instructions for Claude Code (claude.ai/code) when editing this repository.

## What this repo is

Agent State Machine is a **native JavaScript workflow runner**.

You write a workflow as normal `async/await` JavaScript, and the runtime provides:
- `agent(name, params?, options?)` for running specialized task handlers
- `memory` that **persists to disk** on mutation
- `fileTree` that **auto-tracks file changes** made by agents (Git-based detection)
- Human-in-the-loop blocking through `askHuman()` and agent-driven interactions
- Agents implemented as **JS modules** or **Markdown prompt templates**
- LLM calls via local CLI tools or provider APIs
- Agent retries with history logging on failure

---

## CLI commands

```bash
# Scaffold a new workflow folder
state-machine --setup <workflow-name>
state-machine --setup <workflow-name> --template <template-name>

# Run a workflow
state-machine run <workflow-name>
state-machine run <workflow-name> -reset
state-machine run <workflow-name> -reset-hard
state-machine run <workflow-name> -n  # Regenerate remote follow link
  # Remote follow links persist across runs and are stored in the workflow config.

# Inspect / debug
state-machine -reset <workflow-name>
state-machine -reset-hard <workflow-name>
state-machine history <workflow-name> [limit]
state-machine status <workflow-name>

# List all workflows under ./workflows
state-machine list
```

For local development, `npm link` is the simplest way to use the CLI globally.

Templates live under `templates/` and `starter` is the default.

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
  - Captures full prompt traces in `history.jsonl`.
- `lib/index.js`
  - Public exports used by workflows and agents (`agent`, `memory`, `fileTree`, `askHuman`, `parallel`, `llm`, etc.).
- `lib/file-tree.js`
  - Git-based and filesystem change detection utilities.
  - Export extraction for JS/TS files.
- `lib/runtime/track-changes.js`
  - `withChangeTracking()` wrapper that captures baseline before agents run and detects changes after.

### Workflow folder layout (created by `--setup`)

```text
workflows/<name>/
├── workflow.js        # Native JS workflow (async/await)
├── package.json       # Sets "type": "module" for this workflow folder
├── agents/            # JS agents and Markdown agents
├── interactions/      # Human input files (created when paused)
├── state/             # current.json, history.jsonl
└── steering/          # global.md and config.json
```

---

## How workflows are written

Workflows are plain JS modules that export a default async function:

```js
import { agent, memory, fileTree, askHuman, parallel } from 'agent-state-machine';

export const config = {
  models: {
    fast: "claude -p",
    smart: "api:openai:gpt-4.1-mini"
  },
  apiKeys: {
    openai: process.env.OPENAI_API_KEY
  },
  // File tracking (optional - all have defaults)
  // projectRoot: '../..',           // defaults to ../.. from workflow
  // fileTracking: true,             // enable/disable
  // fileTrackingIgnore: [...],      // glob patterns to ignore
  // fileTrackingKeepDeleted: false  // keep deleted files in tree
};

export default async function () {
  const topic = await askHuman('What should we work on?', { slug: 'topic' });
  memory.topic = topic;

  const result = await agent('research', { topic });
  memory.research = result;

  // Files created by agents are auto-tracked in memory.fileTree
  await agent('code-writer', { task: 'Create auth module' });
  console.log(memory.fileTree); // { "src/auth.js": { status: "created", ... } }

  // Pass file context to other agents
  await agent('code-reviewer', { fileTree: memory.fileTree });

  memory.outputs = { topic, research: result };
}
```

### Resume model

Workflows run as standard Node.js processes.
- For persistence, use the `memory` object explicitly.
- If a workflow is interrupted, `state-machine run` re-runs the workflow from the top.
- Since interactions now **block inline**, you generally stay in the same process until completion.

---

## Agents

Agents are loaded from `workflows/<name>/agents/`.
Context is explicit: only the params you pass are included. Pass `memory` (or anything else) yourself when needed.
`agent()` accepts an optional third argument with `retry` (number | false, default 2) and `steering` (string | string[]).

### JavaScript agents

Supported extensions: `.js`, `.mjs`, `.cjs`

An ESM agent typically exports `default`:

```js
import { llm } from 'agent-state-machine';

export default async function (context) {
  // context contains:
  // - params passed to agent(name, params)
  // - context._steering.global and optional additional steering content
  // - context._config (models, apiKeys, workflowDir, projectRoot)
  const resp = await llm(context, { model: 'fast', prompt: 'Say hello.' });

  // Optionally return _files to annotate tracked files with captions
  return {
    text: resp.text,
    _files: [{ path: 'src/hello.js', caption: 'Greeting module' }]
  };
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
steering: tone, product
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
- `steering`: additional steering file(s) to load from `steering/` (comma list or array)
- `interaction`: `"true"` or a string slug to request human input
- `interactionKey`: where the human answer is stored in `memory`
- `autoInteract`: `"false"` to disable auto-detection of interaction blocks in LLM output

---

## Human-in-the-loop interactions

Two ways a workflow can wait for input:

1) `askHuman(...)`
- It will **block inline** in the terminal. You can answer in the terminal, edit `interactions/<slug>.md`, or respond in the browser.

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

When an interaction is requested, the runtime:
1. Creates/updates the interaction file.
2. Blocks execution and prompts the user in the terminal to press `y` after editing interactions/<slug>.md or accepts a browser response.
3. Reads the response and continues execution immediately—**no re-running required**.

---

## State & persistence

Per workflow, persisted files live under `workflows/<name>/state/`:

- `current.json`
  - `memory`: persisted workflow memory (includes `fileTree` if tracking is enabled)
  - `status`: `IDLE | RUNNING | FAILED | COMPLETED`
- `history.jsonl`
  - event log, newest entries prepended (contains full prompt traces and agent retry/failure events)

---

## File tree tracking

The runtime automatically tracks file changes made during agent execution using Git (or filesystem snapshots as fallback).

### How it works

1. Before each `await agent(...)`, the runtime captures a Git baseline
2. After the agent completes, it diffs against baseline to detect created/modified/deleted files
3. Changes are stored in `memory.fileTree` and persisted to `current.json`
4. Agents can optionally return `_files` to add captions or metadata

### Data structure

```js
memory.fileTree = {
  "src/auth.js": {
    path: "src/auth.js",
    status: "created",           // created | modified | deleted
    caption: "Auth module",      // from _files annotation
    createdBy: "code-writer",    // agent that created it
    lastModifiedBy: "code-writer",
    createdAt: "2025-01-15T10:30:00.000Z",
    updatedAt: "2025-01-15T10:30:00.000Z",
    exports: ["login", "logout"] // optional, if extractExports was used
  }
}
```

### Configuration

In your workflow's `config.js`:

```js
export const config = {
  // ... models and apiKeys ...

  projectRoot: process.env.PROJECT_ROOT,  // defaults to ../.. from workflow
  fileTracking: true,                     // enable/disable (default: true)
  fileTrackingIgnore: [                   // patterns to ignore
    'node_modules/**',
    '.git/**',
    'dist/**',
    'workflows/**'
  ],
  fileTrackingKeepDeleted: false          // keep deleted files with status: "deleted"
};
```

### Agent context

Agents automatically receive location context:

- **JS agents**: Access `context._config.workflowDir` and `context._config.projectRoot`
- **Markdown agents**: Prompt includes a "File Context" section with both paths

The prompt footer tells agents:
- Where they're running from (workflowDir)
- Where to create files (projectRoot)
- To use paths relative to projectRoot

### Agent annotations

Agents can return `_files` to annotate tracked files:

```js
return {
  result: "Created auth module",
  _files: [
    { path: "src/auth.js", caption: "Authentication utilities" },
    { path: "src/auth.test.js", caption: "Auth tests", extractExports: true }
  ]
};
```

### Manual tracking

Use these utilities for manual control:

```js
import { trackFile, getFileTree, untrackFile, fileTree } from 'agent-state-machine';

// Track a file manually
trackFile('README.md', { caption: 'Project docs' });

// Access via proxy
console.log(fileTree['src/auth.js']);

// Get all tracked files
const tree = getFileTree();

// Remove from tracking
untrackFile('old-file.js');
```

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

`llm()` pipes the prompt via stdin (or uses a system temp file) and logs the full trace to `history.jsonl`.

---
````
