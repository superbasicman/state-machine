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

### 3. `response-interpreter.md` - Maps Natural Language to Actions

When user responses don't match simple patterns (A/B/C), this agent interprets the intent.

**Input:**
```js
{
  userResponse: "lets run the sanity checks automatically please",
  options: [
    { key: "manual", description: "User will run checks manually" },
    { key: "auto", description: "Run checks automatically" },
    { key: "skip", description: "Skip sanity checks entirely" }
  ]
}
```

**Output:**
```json
{
  "selectedKey": "auto",
  "confidence": "high",
  "reasoning": "User explicitly requested automatic execution"
}
```

This avoids brittle substring matching like `.includes('auto')` which would incorrectly match "don't do auto".

### 4. No separate mitigator needed

On failure, we already have the loop-back mechanism in workflow.js. Just pass the failure results as feedback to code-writer. This keeps things simple.

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

1. [ ] Create `agents/sanity-checker.md`
   - Model: fast (just needs to analyze code and generate commands)
   - Format: json
   - Takes task + implementation, outputs executable checks

2. [ ] Create `agents/sanity-runner.js`
   - JS agent (needs to spawn processes)
   - Executes checks sequentially with timeout protection
   - Returns structured pass/fail results

3. [ ] Create `agents/response-interpreter.md`
   - Model: fast
   - Format: json
   - Takes userResponse + options array, returns selectedKey
   - Used when simple A/B/C matching fails

4. [ ] Update `scripts/workflow-helpers.js`
   - Add `SANITY_CHECK` stage

5. [ ] Update `workflow.js`
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
