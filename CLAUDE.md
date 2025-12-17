# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent State Machine is a workflow orchestrator for running agents and scripts in sequence with state management, conditionals, loops, and forEach support. It executes workflows defined in JavaScript that can call LLMs via CLI tools (claude, gemini, codex) or APIs (Anthropic, OpenAI).

## Commands

```bash
# Create a new workflow
state-machine --setup <workflow-name>

# Run a workflow
state-machine run <workflow-name>

# Resume a failed/paused workflow
state-machine resume <workflow-name>

# Check status / view history / reset
state-machine status <workflow-name>
state-machine history <workflow-name>
state-machine reset <workflow-name>

# List all workflows
state-machine list
```

For local development, use `npm link` to make the CLI available globally.

## Architecture

### Core Files (lib/)

- **state-machine.js**: Core `StateMachine` class that handles workflow execution, step control flow (conditionals, goto, forEach), agent/script loading, state persistence, and interaction pausing
- **llm.js**: LLM integration layer supporting CLI tools (`claude -p`, `gemini`, `codex exec`) and API calls (Anthropic, OpenAI SDKs)
- **setup.js**: Scaffolds new workflows with directory structure
- **index.js**: Public exports (`StateMachine`, `llm`, `llmText`, `llmJSON`, etc.)

### Workflow Structure (created by --setup)

```
workflows/<name>/
├── workflow.js       # Step definitions, model config, initial context
├── agents/           # .js (code) or .md (prompt template) agents
├── scripts/          # Standalone Node.js scripts
├── state/            # Runtime state (current.json, history.jsonl)
├── interactions/     # Human-in-the-loop input files (created at runtime)
└── steering/         # global.md (system prompt) and config.json
```

### Agent Types

**JavaScript agents** (`.js`): Export a handler function `async (context) => context`. Have full control for multi-stage LLM calls, API fetches, etc. Use `const { llm, llmJSON } = require('agent-state-machine')`.

**Markdown agents** (`.md`): YAML frontmatter + prompt template. Supports `{{variable}}` interpolation. Frontmatter options: `model`, `output` (context key), `format` (json/interaction), `includeContext`.

### Control Flow

Workflows support:
- **Simple steps**: `"agent:name"` or `"script:file.js"`
- **Conditionals**: `{ if: (ctx, loop) => boolean, true: { goto: target }, false: { goto: target } }`
- **forEach loops**: `{ forEach: (ctx) => array, as: "item", steps: [...] }`
- **Goto targets**: step index (0, -2), step name (`"agent:done"`), or `'end'`

### State Management

- State is saved to `state/current.json` after every step
- History logged to `state/history.jsonl` (JSONL format, prepended)
- Workflows can be resumed from failure with `state-machine resume`
- Max 10,000 iterations safety limit

### LLM Integration

Models are configured in `workflow.js`:
```javascript
models: {
  fast: "claude -p",                    // CLI
  smart: "api:anthropic:claude-sonnet-4-20250514"  // API
}
```

The `llm()` helper writes prompts to `state/generated-prompt.md` including context and steering, then invokes the CLI or API.
