# Sanity Check Automation - Refined Plan

## Current State Analysis

The `task-planner.md` already generates sanity checks, but they're **descriptive** (what to verify), not **executable** (how to verify). Example:

```
sanityCheck: "Verify the user endpoint returns correct data by testing with a valid user ID"
```

This runs BEFORE implementation, so it can't know specifics like actual file paths, ports, API routes, etc.

## What We Need

After implementation completes, generate **executable** sanity checks based on:
1. The original task + descriptive sanity check
2. The actual implementation (code, file paths, API routes, etc.)

---

## Proposed Architecture

### 1. `sanity-checker.md` - Generates Executable Checks

Takes the task + implementation and produces concrete, runnable verification commands.

**Input:**
```js
{
  task: { title, description, doneDefinition, sanityCheck },
  implementation: { /* code-writer output */ },
  testPlan: { /* test-planner output */ }
}
```

**Output:**
```json
{
  "checks": [
    {
      "id": 1,
      "description": "Verify user endpoint returns 200",
      "type": "shell",
      "command": "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/users/1",
      "expected": "200",
      "comparison": "equals"
    },
    {
      "id": 2,
      "description": "Verify response contains user data",
      "type": "shell",
      "command": "curl -s http://localhost:3000/api/users/1 | jq '.name'",
      "expected": "",
      "comparison": "not_empty"
    },
    {
      "id": 3,
      "description": "Verify file was created",
      "type": "file_exists",
      "path": "./src/routes/users.js"
    }
  ],
  "setup": "npm run dev &",
  "teardown": "pkill -f 'npm run dev'"
}
```

**Check types:**
- `shell` - Run a command, compare output
- `file_exists` - Check file exists
- `file_contains` - Check file contains pattern
- `test_suite` - Run test command, expect exit 0

### 2. `sanity-runner.js` - Executes Checks

A JS agent that executes the checks and returns structured results. Markdown agents can't run commands, so this must be JS.

**Output:**
```json
{
  "summary": { "passed": 2, "failed": 1 },
  "results": [
    { "id": 1, "status": "passed", "output": "200" },
    { "id": 2, "status": "passed", "output": "\"John Doe\"" },
    { "id": 3, "status": "failed", "error": "File not found", "path": "./src/routes/users.js" }
  ]
}
```

### 3. `schemas/interaction.schema.js` - Universal Interaction Schema

A shared schema for any user interaction (multiple choice, text input, confirmation). Used by `askHuman()`, agents, and UI rendering.

**Schema Definition:**
```js
// schemas/interaction.schema.js
export const InteractionSchema = {
  // Required
  type: 'choice' | 'text' | 'confirm',
  slug: 'string',           // Unique identifier for this interaction
  prompt: 'string',         // The question/message to display

  // For type: 'choice'
  options: [
    {
      key: 'string',        // Machine-readable key (e.g., 'auto', 'manual')
      label: 'string',      // Display label (e.g., 'A: Run automatically')
      description: 'string' // Optional longer description
    }
  ],
  allowCustom: 'boolean',   // Allow free-text "Other" option (default: true)
  multiSelect: 'boolean',   // Allow multiple selections (default: false)

  // For type: 'text'
  placeholder: 'string',
  validation: {
    minLength: 'number',
    maxLength: 'number',
    pattern: 'string'       // Regex pattern
  },

  // For type: 'confirm'
  confirmLabel: 'string',   // Default: 'Confirm'
  cancelLabel: 'string',    // Default: 'Cancel'

  // Common
  default: 'string',        // Default value/key
  context: 'object'         // Additional context for interpreter/UI
};
```

**Example Interactions:**

```js
// Multiple choice
{
  type: 'choice',
  slug: 'sanity-check-action',
  prompt: 'How would you like to verify this task?',
  options: [
    { key: 'manual', label: 'Run checks manually', description: 'You run the commands and confirm results' },
    { key: 'auto', label: 'Run automatically', description: 'Agent executes checks and reports results' },
    { key: 'skip', label: 'Skip verification', description: 'Approve without running checks' }
  ],
  allowCustom: true,
  default: 'auto'
}

// Free text
{
  type: 'text',
  slug: 'project-description',
  prompt: 'Describe the project you want to build',
  placeholder: 'A web app that...',
  validation: { minLength: 20 }
}

// Confirmation
{
  type: 'confirm',
  slug: 'roadmap-approval',
  prompt: 'Approve this roadmap?',
  confirmLabel: 'Approve',
  cancelLabel: 'Request Changes',
  context: { documentPath: 'state/roadmap.md' }
}
```

**Response Format:**
```js
// What askHuman/agents return after user responds
{
  slug: 'sanity-check-action',
  selectedKey: 'auto',           // For choice type
  selectedKeys: ['a', 'b'],      // For multiSelect
  text: 'user input here',       // For text type or custom option
  confirmed: true,               // For confirm type
  raw: 'original user input',    // Always included
  interpreted: true              // True if response-interpreter was used
}
```

### 4. `response-interpreter.md` - Maps Natural Language to Actions

When user responses don't match simple patterns (A/B/C), this agent interprets the intent using the interaction schema.

**Input:**
```js
{
  userResponse: "lets run the sanity checks automatically please",
  interaction: {
    type: 'choice',
    slug: 'sanity-check-action',
    options: [
      { key: 'manual', label: 'Run checks manually', description: 'You run the commands and confirm results' },
      { key: 'auto', label: 'Run automatically', description: 'Agent executes checks and reports results' },
      { key: 'skip', label: 'Skip verification', description: 'Approve without running checks' }
    ]
  }
}
```

**Output:**
```json
{
  "selectedKey": "auto",
  "confidence": "high",
  "reasoning": "User explicitly requested automatic execution",
  "isCustom": false
}
```

If user provides a response that doesn't match any option (and `allowCustom: true`):
```json
{
  "selectedKey": null,
  "confidence": "high",
  "reasoning": "User provided custom feedback about specific issues",
  "isCustom": true,
  "customText": "The tests are failing because the database isn't running"
}
```

This avoids brittle substring matching like `.includes('auto')` which would incorrectly match "don't do auto".

### 5. No separate mitigator needed

On failure, we already have the loop-back mechanism in workflow.js. Just pass the failure results as feedback to code-writer. This keeps things simple.

---

## Usage Pattern with Schema

The schema + helpers clean up workflow code significantly:

**Before (inline strings):**
```js
const choice = await askHuman(
  `Options:\n- A: Run manually\n- B: Run automatically\n- C: Skip\n\nYour choice:`,
  { slug: 'sanity-choice' }
);
const choiceLower = choice.trim().toLowerCase();
if (choiceLower.startsWith('a')) { /* ... */ }
// fragile, duplicated logic everywhere
```

**After (schema-based):**
```js
import { createInteraction, parseResponse, formatPrompt } from './scripts/interaction-helpers.js';

const interaction = createInteraction('choice', 'sanity-check-action', {
  prompt: 'How would you like to verify this task?',
  options: [
    { key: 'manual', label: 'Run checks manually' },
    { key: 'auto', label: 'Run automatically' },
    { key: 'skip', label: 'Skip verification' }
  ]
});

const raw = await askHuman(formatPrompt(interaction), { slug: interaction.slug });
const response = await parseResponse(interaction, raw);

if (response.selectedKey === 'auto') { /* ... */ }
else if (response.isCustom) {
  // User said something like "the database isn't running"
  // Use response.customText as feedback
}
```

The `parseResponse` function handles:
1. Simple A/B/C matching (fast path)
2. Falls back to `response-interpreter` agent if no match
3. Detects custom responses when `allowCustom: true`
4. Returns consistent response format

---

## Workflow Integration

After code review completes (line ~320 in workflow.js), before the user approval step:

```js
// 5. Final Security Check
if (stage === TASK_STAGES.SECURITY_POST) {
  // ... existing security check ...
  setTaskStage(i, taskId, TASK_STAGES.SANITY_CHECK);
  stage = TASK_STAGES.SANITY_CHECK;
}

// 6. Sanity Check Generation & Execution (NEW)
if (stage === TASK_STAGES.SANITY_CHECK) {
  // Generate executable checks
  const executableChecks = await agent('sanity-checker', {
    task: task,
    implementation: getTaskData(i, taskId, 'code'),
    testPlan: getTaskData(i, taskId, 'tests')
  });
  setTaskData(i, taskId, 'sanity_checks', executableChecks);

  // Show checks and ask user how to proceed
  const checksDisplay = executableChecks.checks
    .map(c => `  ${c.id}. ${c.description}\n     → ${c.command || c.path || c.testCommand}`)
    .join('\n');

  const choice = await askHuman(
    `Sanity checks for "${task.title}":\n\n${checksDisplay}\n\nOptions:\n` +
    `- A: I'll run these manually and confirm\n` +
    `- B: Run checks automatically\n` +
    `- C: Skip sanity checks and approve\n\nYour choice:`,
    { slug: `phase-${i + 1}-task-${taskId}-sanity-choice` }
  );

  // Determine user's choice - try simple matching first, then interpret
  let action = null;
  const choiceLower = choice.trim().toLowerCase();

  // Fast path: simple A/B/C matching
  if (choiceLower.startsWith('a')) {
    action = 'manual';
  } else if (choiceLower.startsWith('b')) {
    action = 'auto';
  } else if (choiceLower.startsWith('c')) {
    action = 'skip';
  } else {
    // Slow path: interpret natural language response
    const interpretation = await agent('response-interpreter', {
      userResponse: choice,
      options: [
        { key: 'manual', description: 'User will run checks manually and confirm' },
        { key: 'auto', description: 'Run sanity checks automatically' },
        { key: 'skip', description: 'Skip sanity checks and approve task' }
      ]
    });
    action = interpretation.selectedKey;
  }

  if (action === 'auto') {
    // Run checks automatically
    const results = await agent('sanity-runner', {
      checks: executableChecks.checks,
      setup: executableChecks.setup,
      teardown: executableChecks.teardown
    });
    setTaskData(i, taskId, 'sanity_results', results);

    if (results.summary.failed > 0) {
      // Show failures and ask what to do
      const failedChecks = results.results
        .filter(r => r.status === 'failed')
        .map(r => `  - Check ${r.id}: ${r.error}`)
        .join('\n');

      const failChoice = await askHuman(
        `${results.summary.failed} sanity check(s) failed:\n\n${failedChecks}\n\nOptions:\n` +
        `- A: Re-implement task with this feedback\n` +
        `- B: Ignore failures and approve anyway\n\nYour choice:`,
        { slug: `phase-${i + 1}-task-${taskId}-sanity-fail` }
      );

      if (failChoice.trim().toLowerCase().startsWith('a')) {
        // Loop back with failure feedback
        setTaskData(i, taskId, 'feedback', `Sanity check failures:\n${failedChecks}`);
        setTaskData(i, taskId, 'security_pre', null);
        setTaskData(i, taskId, 'tests', null);
        setTaskData(i, taskId, 'code', null);
        setTaskData(i, taskId, 'review', null);
        setTaskData(i, taskId, 'security_post', null);
        setTaskStage(i, taskId, TASK_STAGES.PENDING);
        t--; // Reprocess task
        continue;
      }
    }
    // All passed or user chose to ignore
    setTaskStage(i, taskId, TASK_STAGES.COMPLETED);
  } else if (action === 'skip') {
    // Skip checks, go straight to complete
    setTaskStage(i, taskId, TASK_STAGES.COMPLETED);
  } else {
    // action === 'manual' - go to existing approval flow
    setTaskStage(i, taskId, TASK_STAGES.AWAITING_APPROVAL);
  }

  stage = getTaskStage(i, taskId);
}

// 7. Manual Approval (existing, for when user runs checks themselves)
if (stage === TASK_STAGES.AWAITING_APPROVAL) {
  // ... existing approval code ...
}
```

---

## New TASK_STAGES Value

Add to `workflow-helpers.js`:

```js
export const TASK_STAGES = {
  PENDING: 'pending',
  SECURITY_PRE: 'security_pre',
  TEST_PLANNING: 'test_planning',
  IMPLEMENTING: 'implementing',
  CODE_REVIEW: 'code_review',
  SECURITY_POST: 'security_post',
  SANITY_CHECK: 'sanity_check',      // NEW
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed'
};
```

---

## Implementation Checklist

1. [ ] Create `schemas/interaction.schema.js`
   - Define InteractionSchema type
   - Export schema validation helpers
   - Export response format types

2. [ ] Create `scripts/interaction-helpers.js`
   - `createInteraction(type, slug, options)` - factory for interactions
   - `parseResponse(interaction, rawResponse)` - handles simple matching + interpreter fallback
   - `formatPrompt(interaction)` - renders interaction as terminal text

3. [ ] Create `agents/sanity-checker.md`
   - Model: fast (just needs to analyze code and generate commands)
   - Format: json
   - Takes task + implementation, outputs executable checks

4. [ ] Create `agents/sanity-runner.js`
   - JS agent (needs to spawn processes)
   - Executes checks sequentially with timeout protection
   - Returns structured pass/fail results

5. [ ] Create `agents/response-interpreter.md`
   - Model: fast
   - Format: json
   - Takes userResponse + interaction schema, returns structured response
   - Handles custom/freeform responses when allowCustom is true

6. [ ] Update `scripts/workflow-helpers.js`
   - Add `SANITY_CHECK` stage

7. [ ] Update `workflow.js`
   - Refactor askHuman calls to use interaction schema
   - Insert sanity check step between SECURITY_POST and AWAITING_APPROVAL
   - Add user choice flow with interpreter fallback
   - Wire up failure loop-back

---

## Design Notes

- **Why not enhance task-planner?** It runs BEFORE implementation. We need checks based on what was actually built.
- **Why no mitigator agent?** The existing feedback loop to code-writer is simpler and keeps context. Adding another agent would fragment the conversation.
- **Why offer manual option?** Some checks may need human judgment (visual UI, complex integration scenarios). User should always have control.
- **Timeout protection** - sanity-runner should timeout individual checks (e.g., 30s) to prevent hanging on broken services.
- **Two-tier response matching** - Simple A/B/C matching is fast and free. The interpreter agent is only called when needed, avoiding unnecessary LLM calls while still handling natural language like "yeah run them automatically" or "skip it, looks good".
- **Why a universal schema?**
  - **Consistency** - All interactions follow the same pattern, reducing cognitive load
  - **UI-ready** - The schema can render to terminal, web UI, or mobile with different formatters
  - **Testable** - Interactions are data, making them easy to unit test
  - **Reusable** - Same schema powers `askHuman()`, agent-requested interactions, and the interpreter
  - **Self-documenting** - Looking at an interaction schema tells you exactly what's being asked
