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

### 4. Agent-Returned Interactions

Agents can return an interaction schema when they need user input. The runtime detects `_interaction` and handles it automatically.

**Agent returning a choice interaction:**
```js
// In a JS agent
export default async function(context) {
  // Agent does some work...
  const analysis = analyzeCode(context.code);

  // Agent needs user decision
  if (analysis.hasMultipleApproaches) {
    return {
      _interaction: {
        type: 'choice',
        slug: 'approach-selection',
        prompt: 'Multiple implementation approaches found. Which do you prefer?',
        options: analysis.approaches.map(a => ({
          key: a.id,
          label: a.name,
          description: a.tradeoffs
        })),
        allowCustom: true
      }
    };
  }

  // Normal return
  return { result: analysis };
}
```

**Markdown agent returning interaction (via frontmatter + output):**
```md
---
model: fast
format: json
---

Analyze the task and determine if user input is needed.

If you need the user to make a choice, return:
{
  "_interaction": {
    "type": "choice",
    "slug": "{{slug}}",
    "prompt": "Your question here",
    "options": [
      { "key": "option1", "label": "Option 1", "description": "..." }
    ]
  }
}

Otherwise return your normal result.
```

**Runtime handling:**
```js
// In runtime, after agent execution
const result = await agent('some-agent', params);

if (result._interaction) {
  // Agent requested user input - handle via interaction system
  const interaction = result._interaction;
  const raw = await askHuman(formatPrompt(interaction), { slug: interaction.slug });
  const response = await parseResponse(interaction, raw);

  // Re-run agent with user's response
  const finalResult = await agent('some-agent', {
    ...params,
    userResponse: response
  });
  return finalResult;
}
```

This lets agents dynamically request user input mid-execution without the workflow needing to anticipate every possible interaction point.

### 5. `response-interpreter.md` - Maps Natural Language to Actions

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

### 6. No separate mitigator needed

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
import { createInteraction, parseResponse, formatPrompt } from './scripts/interaction-helpers.js';

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

  // Build checks display
  const checksDisplay = executableChecks.checks
    .map(c => `  ${c.id}. ${c.description}\n     → ${c.command || c.path || c.testCommand}`)
    .join('\n');

  // Create interaction using schema
  const interaction = createInteraction('choice', `phase-${i + 1}-task-${taskId}-sanity-choice`, {
    prompt: `Sanity checks for "${task.title}":\n\n${checksDisplay}\n\nHow would you like to proceed?`,
    options: [
      { key: 'manual', label: 'Run checks manually', description: 'You run the commands and confirm results' },
      { key: 'auto', label: 'Run automatically', description: 'Agent executes checks and reports results' },
      { key: 'skip', label: 'Skip verification', description: 'Approve without running checks' }
    ],
    allowCustom: true
  });

  const raw = await askHuman(formatPrompt(interaction), { slug: interaction.slug });
  const response = await parseResponse(interaction, raw);

  // Handle custom response (user gave feedback instead of choosing)
  if (response.isCustom) {
    setTaskData(i, taskId, 'feedback', response.customText);
    setTaskStage(i, taskId, TASK_STAGES.PENDING);
    t--;
    continue;
  }

  const action = response.selectedKey;

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

## UI Components

The web UI needs to render different interaction types. The current `InteractionForm.jsx` only handles text input.

### Updated `InteractionForm.jsx` (router component)

```jsx
import ChoiceInteraction from './ChoiceInteraction';
import ConfirmInteraction from './ConfirmInteraction';
import TextInteraction from './TextInteraction';

export default function InteractionForm({ interaction, onSubmit, disabled }) {
  // interaction now contains the full schema
  const { type } = interaction;

  const handleResponse = (response) => {
    // All child components return standardized response format
    onSubmit(interaction.slug, interaction.targetKey, response);
  };

  switch (type) {
    case 'choice':
      return <ChoiceInteraction interaction={interaction} onSubmit={handleResponse} disabled={disabled} />;
    case 'confirm':
      return <ConfirmInteraction interaction={interaction} onSubmit={handleResponse} disabled={disabled} />;
    case 'text':
    default:
      return <TextInteraction interaction={interaction} onSubmit={handleResponse} disabled={disabled} />;
  }
}
```

### `ChoiceInteraction.jsx`

```jsx
import { useState } from 'react';
import { Bot, Check } from 'lucide-react';

export default function ChoiceInteraction({ interaction, onSubmit, disabled }) {
  const { prompt, options, multiSelect, allowCustom } = interaction;
  const [selected, setSelected] = useState(multiSelect ? [] : null);
  const [customText, setCustomText] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const handleSelect = (key) => {
    if (multiSelect) {
      setSelected(prev =>
        prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      );
      setShowCustom(false);
    } else {
      setSelected(key);
      setShowCustom(false);
    }
  };

  const handleSubmit = () => {
    if (showCustom && customText.trim()) {
      onSubmit({ isCustom: true, customText: customText.trim(), raw: customText.trim() });
    } else if (multiSelect && selected.length > 0) {
      onSubmit({ selectedKeys: selected, raw: selected.join(', ') });
    } else if (selected) {
      onSubmit({ selectedKey: selected, raw: selected });
    }
  };

  const isValid = showCustom ? customText.trim() : (multiSelect ? selected.length > 0 : selected);

  return (
    <div className="w-full h-full flex flex-col items-stretch overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scroll px-6 py-12 space-y-8 flex flex-col items-center">
        {/* Header */}
        <div className="space-y-4 shrink-0">
          <div className="w-16 h-16 rounded-3xl bg-accent text-white flex items-center justify-center mx-auto shadow-2xl shadow-accent/40">
            <Bot className="w-8 h-8" />
          </div>
          <h3 className="text-4xl font-extrabold tracking-tight text-fg pt-4 text-center">Choose an option.</h3>
        </div>

        {/* Prompt */}
        <div className="text-xl font-medium text-fg/70 text-center max-w-2xl whitespace-pre-wrap">
          {prompt}
        </div>

        {/* Options */}
        <div className="w-full max-w-2xl space-y-3">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => handleSelect(opt.key)}
              disabled={disabled}
              className={`w-full p-6 rounded-2xl border-2 transition-all text-left ${
                (multiSelect ? selected.includes(opt.key) : selected === opt.key)
                  ? 'border-accent bg-accent/10'
                  : 'border-white/10 hover:border-white/20 bg-black/[0.03] dark:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                  (multiSelect ? selected.includes(opt.key) : selected === opt.key)
                    ? 'border-accent bg-accent text-white'
                    : 'border-white/20'
                }`}>
                  {(multiSelect ? selected.includes(opt.key) : selected === opt.key) && <Check className="w-4 h-4" />}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-lg">{opt.label}</div>
                  {opt.description && <div className="text-sm text-fg/50 mt-1">{opt.description}</div>}
                </div>
              </div>
            </button>
          ))}

          {/* Custom/Other option */}
          {allowCustom && (
            <button
              onClick={() => { setShowCustom(true); setSelected(multiSelect ? [] : null); }}
              disabled={disabled}
              className={`w-full p-6 rounded-2xl border-2 transition-all text-left ${
                showCustom
                  ? 'border-accent bg-accent/10'
                  : 'border-white/10 hover:border-white/20 bg-black/[0.03] dark:bg-white/[0.03]'
              }`}
            >
              <div className="font-bold text-lg">Other</div>
              <div className="text-sm text-fg/50 mt-1">Provide a custom response</div>
            </button>
          )}

          {/* Custom text input */}
          {showCustom && (
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Type your response..."
              className="w-full h-32 p-6 rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border-2 border-accent/30 focus:border-accent focus:outline-none text-lg"
            />
          )}
        </div>
      </div>

      {/* Submit button */}
      <div className="p-4 flex justify-center bg-gradient-to-t from-bg via-bg to-transparent shrink-0 border-t border-white/5">
        <button
          onClick={handleSubmit}
          disabled={disabled || !isValid}
          className="px-12 py-6 bg-fg text-bg rounded-full font-bold text-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-2xl"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
```

### `ConfirmInteraction.jsx`

```jsx
import { Bot } from 'lucide-react';

export default function ConfirmInteraction({ interaction, onSubmit, disabled }) {
  const { prompt, confirmLabel = 'Confirm', cancelLabel = 'Cancel', context } = interaction;

  return (
    <div className="w-full h-full flex flex-col items-stretch overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scroll px-6 py-12 space-y-8 flex flex-col items-center justify-center">
        <div className="space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-accent text-white flex items-center justify-center mx-auto shadow-2xl shadow-accent/40">
            <Bot className="w-8 h-8" />
          </div>
          <h3 className="text-4xl font-extrabold tracking-tight text-fg pt-4 text-center">Confirm action.</h3>
        </div>

        <div className="text-xl font-medium text-fg/70 text-center max-w-2xl whitespace-pre-wrap">
          {prompt}
        </div>

        {context?.documentPath && (
          <div className="text-sm text-fg/40 text-center">
            Review: <code className="bg-white/10 px-2 py-1 rounded">{context.documentPath}</code>
          </div>
        )}
      </div>

      {/* Two-button layout */}
      <div className="p-4 flex justify-center gap-4 bg-gradient-to-t from-bg via-bg to-transparent shrink-0 border-t border-white/5">
        <button
          onClick={() => onSubmit({ confirmed: false, raw: cancelLabel })}
          disabled={disabled}
          className="px-12 py-6 bg-white/10 text-fg rounded-full font-bold text-xl hover:bg-white/20 transition-all disabled:opacity-30"
        >
          {cancelLabel}
        </button>
        <button
          onClick={() => onSubmit({ confirmed: true, raw: confirmLabel })}
          disabled={disabled}
          className="px-12 py-6 bg-fg text-bg rounded-full font-bold text-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-2xl"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
```

### `TextInteraction.jsx` (extracted from current form)

```jsx
import { useState } from 'react';
import { Bot } from 'lucide-react';

export default function TextInteraction({ interaction, onSubmit, disabled }) {
  const { prompt, placeholder, validation } = interaction;
  const [text, setText] = useState('');
  const [error, setError] = useState(null);

  const validate = (value) => {
    if (!validation) return null;
    if (validation.minLength && value.length < validation.minLength) {
      return `Minimum ${validation.minLength} characters required`;
    }
    if (validation.maxLength && value.length > validation.maxLength) {
      return `Maximum ${validation.maxLength} characters allowed`;
    }
    if (validation.pattern && !new RegExp(validation.pattern).test(value)) {
      return 'Invalid format';
    }
    return null;
  };

  const handleSubmit = () => {
    const err = validate(text.trim());
    if (err) {
      setError(err);
      return;
    }
    onSubmit({ text: text.trim(), raw: text.trim() });
  };

  return (
    <div className="w-full h-full flex flex-col items-stretch overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scroll px-6 py-12 space-y-8 flex flex-col items-center">
        <div className="space-y-4 shrink-0">
          <div className="w-16 h-16 rounded-3xl bg-accent text-white flex items-center justify-center mx-auto shadow-2xl shadow-accent/40">
            <Bot className="w-8 h-8" />
          </div>
          <h3 className="text-4xl font-extrabold tracking-tight text-fg pt-4 text-center">Action required.</h3>
        </div>

        <div className="w-full max-w-2xl space-y-4">
          <div className="text-xl font-medium text-fg/70 text-center whitespace-pre-wrap">
            {prompt || 'Provide your response.'}
          </div>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            disabled={disabled}
            placeholder={placeholder || 'Your response...'}
            className={`w-full h-64 p-8 rounded-[32px] bg-black/[0.03] dark:bg-white/[0.03] border-2 ${
              error ? 'border-red-500' : 'border-transparent'
            } focus:ring-4 focus:ring-accent/10 focus:outline-none text-2xl font-medium transition-all text-center placeholder:opacity-20`}
          />
          {error && <div className="text-red-500 text-center text-sm">{error}</div>}
        </div>
      </div>

      <div className="p-4 flex justify-center bg-gradient-to-t from-bg via-bg to-transparent shrink-0 border-t border-white/5">
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          className="px-12 py-6 bg-fg text-bg rounded-full font-bold text-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-30 shadow-2xl"
        >
          Submit Response
        </button>
      </div>
    </div>
  );
}
```

### Backend: Include interaction schema in API response

The interaction endpoint needs to return the full schema, not just `question`:

```js
// In API route that serves interactions
return {
  slug: interaction.slug,
  targetKey: interaction.targetKey,
  // Old field for backwards compat
  question: interaction.prompt,
  // New: full interaction schema
  type: interaction.type || 'text',
  prompt: interaction.prompt,
  options: interaction.options,
  allowCustom: interaction.allowCustom,
  multiSelect: interaction.multiSelect,
  validation: interaction.validation,
  confirmLabel: interaction.confirmLabel,
  cancelLabel: interaction.cancelLabel,
  context: interaction.context
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

3. [ ] Create `agents/response-interpreter.md`
   - Model: fast
   - Format: json
   - Takes userResponse + interaction schema, returns structured response
   - Handles custom/freeform responses when allowCustom is true

4. [ ] Update `lib/runtime/agent.js`
   - Detect `_interaction` in agent return value
   - Handle interaction flow (prompt user, parse response, re-run agent)
   - Pass `userResponse` back to agent on re-run

5. [ ] Create `agents/sanity-checker.md`
   - Model: fast (just needs to analyze code and generate commands)
   - Format: json
   - Takes task + implementation, outputs executable checks

6. [ ] Create `agents/sanity-runner.js`
   - JS agent (needs to spawn processes)
   - Executes checks sequentially with timeout protection
   - Returns structured pass/fail results

7. [ ] Update `scripts/workflow-helpers.js`
   - Add `SANITY_CHECK` stage

8. [ ] Update `workflow.js`
   - Refactor askHuman calls to use interaction schema
   - Insert sanity check step between SECURITY_POST and AWAITING_APPROVAL
   - Wire up failure loop-back

9. [ ] Update UI components for interaction types
   - Update `InteractionForm.jsx` to detect interaction type and render appropriate component
   - Create `ChoiceInteraction.jsx` - radio/chip selection for single choice, checkboxes for multiSelect
   - Create `ConfirmInteraction.jsx` - two-button confirm/cancel layout
   - Create `TextInteraction.jsx` (extract from existing) - add validation support
   - All components use same response format back to parent

10. [ ] Update backend API for interaction schema
    - Modify interaction endpoint to return full schema (type, options, etc.)
    - Keep backwards compat with `question` field
    - Update interaction file format to store schema

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
- **Why agent-returned interactions?**
  - Agents can dynamically request input without workflows anticipating every case
  - Same schema format whether interaction comes from workflow or agent
  - Runtime handles the flow automatically - agents don't need to know about `askHuman`
  - Enables "smart" agents that ask clarifying questions only when needed
