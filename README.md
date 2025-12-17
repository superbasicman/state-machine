# Agent State Machine

A workflow orchestrator for running agents and scripts in sequence with state management, conditionals, loops, and forEach support.

## Installation

```bash
npm install -g agent-state-machine
# or
npm install agent-state-machine
```

## Quick Start

```bash
# Create a new workflow
state-machine --setup my-workflow

# Run the workflow
state-machine run my-workflow

# Check status
state-machine status my-workflow

# View history
state-machine history my-workflow
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `state-machine --setup <name>` | Create a new workflow project |
| `state-machine run <name>` | Run a workflow |
| `state-machine status <name>` | Show current state |
| `state-machine history <name>` | Show execution history |
| `state-machine reset <name>` | Reset workflow state |
| `state-machine list` | List all workflows (shows status) |

## Workflow Structure

When you run `state-machine --setup my-workflow`, it creates:

```
workflows/my-workflow/
├── workflow.js        # Workflow definition (JavaScript)
├── agents/            # Custom agent modules
│   └── example.js
├── interactions/      # Human-in-the-loop inputs (created at runtime)
├── scripts/           # Executable scripts
│   └── hello.js
├── state/             # Runtime state
│   ├── current.json   # Current execution state
│   └── history.jsonl  # Execution history
├── steering/          # Steering configuration
│   ├── config.json
│   └── global.md      # Global prompt for all agents
└── README.md
```

## Workflow Configuration (workflow.js)

Workflows are defined in JavaScript for maximum flexibility:

```javascript
module.exports = {
  name: "my-workflow",
  description: "My awesome workflow",
  version: "1.0.0",
  
  initialContext: {
    // Starting data
    items: ["a", "b", "c"]
  },
  
  steps: [
    // Simple steps
    "agent:fetch-data",
    "script:process.js",
    
    // Conditional with goto
    {
      if: (context, loop) => context.status === 'error',
      true: { goto: "agent:error-handler" },
      false: { goto: 2 }  // Jump to step index 2
    },
    
    // forEach loop
    {
      forEach: (context) => context.items,
      as: "currentItem",
      parallel: false,
      steps: [
        "agent:process-item"
      ]
    },
    
    // Loop guard
    {
      if: (context, loop) => loop.count > 100,
      true: { goto: "agent:notify-human" },
      false: { goto: "agent:done" }
    },
    
    "agent:done",
    
    // Exit workflow
    {
      if: () => true,
      true: { goto: 'end' },
      false: { goto: 'end' }
    },
    
    "agent:error-handler",
    "agent:notify-human"
  ]
};
```

## Step Types

### Simple Steps (Agents & Scripts)

```javascript
steps: [
  "agent:my-agent",      // Runs agents/my-agent.js
  "script:process.js",   // Runs scripts/process.js
]
```

### Conditional Steps

Use conditions with real JavaScript functions:

```javascript
{
  if: (context, loop) => context.count < 5,
  true: { goto: 0 },           // Go to step index 0
  false: { goto: "agent:done" } // Go to step named "agent:done"
}
```

**Goto targets:**
- `{ goto: 0 }` - Jump to step index 0
- `{ goto: -2 }` - Jump back 2 steps (relative)
- `{ goto: "agent:name" }` - Jump to named step
- `{ goto: 'end' }` - Exit workflow immediately

### forEach Steps

Process arrays with nested steps:

```javascript
{
  forEach: (context) => context.items,
  as: "item",           // Available as context.item and context.itemIndex
  parallel: false,      // Set true for parallel execution
  steps: [
    "agent:process-item",
    "agent:validate-item"
  ]
}
```

## Loop Tracking

The `loop` object is passed to conditionals and available in context:

```javascript
{
  if: (context, loop) => {
    // loop.count - Total iterations since workflow start
    // loop.stepCounts[i] - Times step i has executed
    return loop.count > 100;
  },
  true: { goto: "agent:notify-human" },
  false: { goto: 0 }
}
```

Agents receive loop info via `context._loop`:

```javascript
async function handler(context) {
  console.log('Iteration:', context._loop.count);
  console.log('This step has run:', context._loop.stepCounts[currentIndex]);
  return context;
}
```

## Agent Types

Agents can be written as JavaScript files (`.js`) or Markdown files (`.md`).

### JavaScript Agents (.js)

Full control with code - fetch APIs, process data, chain LLM calls:

```javascript
// agents/processor.js
const { llm, llmJSON } = require('agent-state-machine');

async function handler(context) {
  // Your logic here
  const response = await llm(context, {
    model: 'smart',
    prompt: `Process: ${context.data}`
  });
  
  return { ...context, result: response.text };
}

module.exports = handler;
```

### Markdown Agents (.md)

Simple prompt templates - great for single LLM calls:

```markdown
---
model: smart
output: summary
format: json
includeContext: true
---

# Summarization Task

Summarize the following: {{content}}

Return as JSON: { "summary": "...", "keyPoints": [...] }
```

**Frontmatter options:**
- `model` - Which model to use (from workflow.js models)
- `output` - Context key to store the response (default: "result")
- `format` - Set to "json" to auto-parse JSON responses, or "interaction" to pause via `interactions/<slug>.md`
- `includeContext` - Include full context in prompt (default: true)
- `interaction` - Optional slug name for the interaction file (also forces interaction mode)
- `interactionKey` - Context key to store the final `interactions/<slug>.md` contents (defaults to `output`)
- `autoInteract` - Set to "false" to disable auto-pausing heuristics

**Variable interpolation:**
- `{{variableName}}` - Replaced with `context.variableName`
- `{{nested.value}}` - Supports nested paths

### Example Agents

**Markdown - Simple Summarizer:**
```markdown
---
model: fast
output: summary
---

Summarize this text concisely: {{text}}
```

**Markdown - JSON Extractor:**
```markdown
---
model: smart
output: entities
format: json
---

Extract entities from: {{content}}

Return: { "people": [], "places": [], "dates": [] }
```

**JavaScript - Multi-stage Processor:**
```javascript
const { llm, llmJSON } = require('agent-state-machine');

async function handler(context) {
  // Stage 1: Extract
  const extracted = await llmJSON(context, {
    model: 'fast',
    prompt: `Extract key points from: ${context.document}`
  });
  
  // Stage 2: Summarize
  const summary = await llm(context, {
    model: 'smart', 
    prompt: `Summarize these points: ${extracted.data.points.join(', ')}`
  });
  
  return {
    ...context,
    keyPoints: extracted.data.points,
    summary: summary.text
  };
}

module.exports = handler;
```

**JavaScript - API + LLM:**
```javascript
const { llm } = require('agent-state-machine');
const https = require('https');

async function handler(context) {
  // Fetch data
  const data = await fetchFromAPI(context.url);
  
  // Process with LLM
  const analysis = await llm(context, {
    model: 'smart',
    prompt: `Analyze this data: ${JSON.stringify(data)}`
  });
  
  return { ...context, data, analysis: analysis.text };
}
```

## LLM Integration

Agents can call LLMs using CLI tools or APIs. Configure models in `workflow.js`:

```javascript
module.exports = {
  name: "my-workflow",
  
  // Define models - CLI commands or API references
  models: {
    fast: "claude -p",                               // Claude CLI
    smart: "claude -m claude-sonnet-4-20250514 -p",    // Claude Sonnet
    genius: "claude -m claude-opus-4-20250514 -p",     // Claude Opus
    gemini: "gemini",                                // Gemini CLI
    codex: "codex",                                  // Codex CLI
    // API-based models (requires SDK):
    apiClaude: "api:anthropic:claude-sonnet-4-20250514",
    apiGpt4: "api:openai:gpt-4-turbo",
  },
  
  // API keys (or use environment variables)
  apiKeys: {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  },
  
  steps: [...]
};
```

### Using LLM in Agents

```javascript
const { llm, llmText, llmJSON } = require('agent-state-machine');

async function handler(context) {
  // Basic call - returns { text, model, provider, usage }
  const response = await llm(context, {
    model: 'smart',  // Key from workflow.js models
    prompt: 'Summarize this text: ' + context.text
  });
  
  // Simple text response
  const text = await llmText(context, {
    model: 'fast',
    prompt: 'Generate a title'
  });
  
  // JSON response (auto-parses)
  const { data } = await llmJSON(context, {
    model: 'smart',
    prompt: 'Return a JSON object with name and age fields'
  });
  
  return { ...context, summary: response.text };
}
```

### How It Works

1. **Prompt Generation**: Creates `state/generated-prompt.md` with:
   - `steering/global.md` as system instructions
   - Current context as JSON
   - Your prompt as the task

2. **CLI Execution**: Runs the configured command with the prompt file:
   ```bash
   claude -p -f state/generated-prompt.md
   ```

3. **API Execution**: Calls the SDK directly with API key from config or environment

### LLM Options

```javascript
await llm(context, {
  model: 'smart',           // Required: model key from workflow.js
  prompt: 'Your prompt',    // Required: the task
  includeContext: true,     // Include context in prompt (default: true)
  maxTokens: 4096,          // Max tokens for API calls
});
```

## Creating Scripts

Scripts are standalone Node.js files:

```javascript
// scripts/my-script.js
const context = JSON.parse(process.env.AGENT_CONTEXT || '{}');
const steering = process.env.AGENT_STEERING || '';
const loopCount = process.env.AGENT_LOOP_COUNT || '0';

// Do processing...

// Output JSON on last line to update context
console.log(JSON.stringify({ result: 'data' }));
```

## Steering

The `steering/` directory contains configuration that affects all agents.

### global.md

If `steering/global.md` exists, its contents are injected into every step:

- **Agents**: `context._steering.global`
- **Scripts**: `AGENT_STEERING` environment variable

Use for LLM system prompts, global constraints, or shared configuration.

### config.json

```json
{
  "enabled": true,
  "globalPrompt": "global.md"
}
```

## Built-in Agents

| Agent | Description |
|-------|-------------|
| `echo` | Logs context and returns it |
| `transform` | Adds transformation metadata |
| `validate` | Validates context is an object |
| `log` | Logs context without modification |
| `delay` | Waits for `context._delay` ms (default 1000) |

## State Management

### current.json

Tracks execution state, updated after every step:

```json
{
  "status": "WORKFLOW_COMPLETED",
  "workflow": { "name": "my-workflow", "stepCount": 5 },
  "currentStepIndex": 4,
  "context": { "result": "data" },
  "loop": {
    "count": 12,
    "stepCounts": { "0": 3, "1": 3, "2": 3, "3": 1, "4": 1 }
  },
  "startedAt": "2024-01-01T00:00:00.000Z",
  "lastUpdatedAt": "2024-01-01T00:00:01.000Z",
  "error": null
}
```

### history.jsonl

Logs all workflow events (JSON Lines format):

```jsonl
{"event":"WORKFLOW_STARTED","workflow":"my-workflow","timestamp":"..."}
{"event":"STEP_STARTED","step":"agent:example","loopCount":1,"timestamp":"..."}
{"event":"STEP_COMPLETED","step":"agent:example","timestamp":"..."}
{"event":"WORKFLOW_COMPLETED","totalIterations":12,"timestamp":"..."}
```

## Environment Variables (Scripts)

| Variable | Description |
|----------|-------------|
| `AGENT_CONTEXT` | JSON string of current context |
| `AGENT_STEERING` | Contents of global.md (if present) |
| `AGENT_LOOP_COUNT` | Current iteration count |
| `WORKFLOW_DIR` | Path to workflow directory |
| `WORKFLOW_NAME` | Name of the workflow |

## Programmatic Usage

```javascript
const { StateMachine } = require('agent-state-machine');

const sm = new StateMachine('my-workflow');

// Run workflow
const result = await sm.run();

// Check status
const state = sm.loadCurrentState();

// View history
const history = sm.loadHistory();
```

## Safety Features

- **Max iterations**: Workflows automatically fail after 10,000 iterations to prevent infinite loops
- **Error handling**: Failed steps mark the workflow as failed and exit with non-zero code
- **State persistence**: State is saved after every step, allowing inspection of failures

## License

MIT
