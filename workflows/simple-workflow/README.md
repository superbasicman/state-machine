# simple-workflow

A workflow created with agent-state-machine.

## Structure

```
simple-workflow/
├── workflow.js    # Workflow definition and steps
├── agents/          # Custom agent modules
├── scripts/         # Executable scripts
├── state/           # Runtime state (current.json, history.jsonl)
└── steering/        # Steering configuration (future)
```

## Usage

Run the workflow:
```bash
state-machine run simple-workflow
```

Check status:
```bash
state-machine status simple-workflow
```

View history:
```bash
state-machine history simple-workflow
```

Reset state:
```bash
state-machine reset simple-workflow
```

## Adding Steps

Edit `workflow.js` to add steps:

```json
{
  "steps": [
    "agent:example",      // Runs agents/example.js
    "script:hello.js",    // Runs scripts/hello.js
    "agent:my-agent",     // Add your own agents
    "script:process.js"   // Add your own scripts
  ]
}
```

## Creating Agents

Create a new file in `agents/`:

```javascript
async function handler(context) {
  // Process context
  return { ...context, myData: 'value' };
}
module.exports = handler;
```

## Creating Scripts

Create a new file in `scripts/`:

```javascript
const context = JSON.parse(process.env.AGENT_CONTEXT || '{}');
// Process...
console.log(JSON.stringify({ result: 'data' }));
```
