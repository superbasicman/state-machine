# Agent State Machine - Repository Structure (Native JS Only)

```
agent-state-machine/
│
├── package.json              # NPM package configuration
├── README.md                 # Documentation
│
├── bin/
│   └── cli.js                # CLI entry point (state-machine command)
│
├── lib/
│  ├── runtime/
│  │  ├── agent.js            # Agent execution
│  │  ├── index.js            # Runtime exports
│  │  ├── memory.js           # Memory management
│  │  ├── parallel.js         # Parallel execution
│  │  ├── prompt.js           # Prompt generation
│  │  └── runtime.js          # Runtime management
│  │
│  ├── index.js               # Public API exports (native only)
│  ├── index.mjs              # ESM re-export shim
│  ├── llm.js                 # LLM integration (CLI + API)
│  └── setup.js               # Workflow scaffolding (--setup command)
```

## Created Workflow Structure

When you run `state-machine --setup my-workflow`:

```
your-project/
└── workflows/
    └── my-workflow/
        ├── workflow.js       # Native JS workflow (async/await)
        ├── package.json      # Sets "type": "module" for this workflow folder
        ├── agents/           # Your agents
        │   ├── example.js    # JS agent template (ESM)
        │   └── greeter.md    # MD agent template
        ├── interactions/     # Human-in-the-loop inputs (created at runtime)
        ├── state/            # Auto-managed runtime state
        │   ├── current.json
        │   ├── history.jsonl
        │   └── prompts/   # Generated prompts history
        ├── steering/
        │   ├── config.json
        │   └── global.md     # System prompt for all agents
        └── README.md
```

## Usage

```bash
# Create a workflow
state-machine --setup my-workflow

# Run it
state-machine run my-workflow

# Resume (re-run; cached work is skipped)
state-machine resume my-workflow

# Check status
state-machine status my-workflow

# View history
state-machine history my-workflow

# Reset
state-machine reset my-workflow

# List all workflows
state-machine list
```
