# Agent State Machine - Repository Structure

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
│   ├── index.js              # Main exports
│   ├── state-machine.js      # Core StateMachine class
│   ├── setup.js              # Workflow scaffolding (--setup command)
│   └── llm.js                # LLM integration (CLI + API)
│
└── examples/                 # Example agents (optional, for reference)
    ├── workflow.js           # Example workflow configuration
    └── agents/
        ├── summarizer.md     # Markdown agent - summarization
        ├── translator.md     # Markdown agent - translation
        ├── extractor.md      # Markdown agent - entity extraction
        ├── classifier.md     # Markdown agent - text classification
        ├── code-reviewer.md  # Markdown agent - code review
        ├── story-writer.md   # Markdown agent - creative writing
        ├── qa-responder.md   # Markdown agent - Q&A
        ├── answerer.md       # Markdown agent - question answering
        ├── email-drafter.md  # Markdown agent - email drafting
        ├── fetcher.js        # JS agent - HTTP requests with retry
        ├── processor.js      # JS agent - multi-stage LLM processing
        ├── validator.js      # JS agent - data validation
        ├── sentiment.js      # JS agent - sentiment analysis
        ├── doc-processor.js  # JS agent - document processing
        ├── file-handler.js   # JS agent - file operations
        └── human-input.js    # JS agent - human-in-the-loop
```

## Quick Setup

```bash
# 1. Clone or create directory
mkdir agent-state-machine
cd agent-state-machine

# 2. Copy all files maintaining structure above

# 3. Make CLI executable
chmod +x bin/cli.js

# 4. Install globally
npm link

# 5. Verify installation
state-machine --help
```

## File Descriptions

### Core Files (Required)

| File | Size | Purpose |
|------|------|---------|
| `package.json` | ~500B | NPM config, defines `state-machine` CLI |
| `bin/cli.js` | ~4KB | CLI commands: run, resume, status, etc. |
| `lib/index.js` | ~300B | Public API exports |
| `lib/state-machine.js` | ~35KB | Core engine: steps, conditionals, loops |
| `lib/setup.js` | ~8KB | Scaffolds new workflows |
| `lib/llm.js` | ~7KB | LLM helper (CLI + API support) |

### Example Files (Optional)

The `examples/` folder contains ready-to-use agents you can copy into your workflows.

## Created Workflow Structure

When you run `state-machine --setup my-workflow`:

```
your-project/
└── workflows/
    └── my-workflow/
        ├── workflow.js       # Define steps, models, initial context
        ├── agents/           # Your agents
        │   ├── example.js    # JS agent template
        │   └── greeter.md    # MD agent template
        ├── interactions/     # Human-in-the-loop inputs (created at runtime)
        ├── scripts/          # Standalone scripts
        │   └── hello.js
        ├── state/            # Auto-managed runtime state
        │   ├── current.json
        │   ├── history.jsonl
        │   └── generated-prompt.md
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

# If it fails, resume
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
