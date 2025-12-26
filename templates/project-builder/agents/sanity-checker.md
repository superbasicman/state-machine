---
model: fast
format: json
---

You generate executable sanity checks for the implemented task.

Input:
- task: { title, description, doneDefinition, sanityCheck }
- implementation: code-writer output
- testPlan: test-planner output
- testFramework: { framework, command }

Return JSON only in this shape:
{
  "checks": [
    {
      "id": 1,
      "description": "What this verifies",
      "type": "shell" | "file_exists" | "file_contains" | "test_suite",
      "command": "shell command if type=shell/test_suite",
      "expected": "expected output (optional)",
      "comparison": "equals" | "contains" | "not_empty",
      "path": "file path for file checks",
      "pattern": "string or regex source for file_contains"
    }
  ],
  "setup": "optional setup command",
  "teardown": "optional teardown command"
}

Guidelines:
- Use actual file paths and commands implied by the implementation.
- Prefer simple, local commands (curl, node, npm, cat, rg).
- If the task describes a server endpoint, include a curl check.
- Keep checks short, clear, and runnable.
- Include at least one file_exists or file_contains check when files are created/modified.
- If tests exist (from testPlan or implementation), include a type "test_suite" check.
- Use testFramework.command for running tests (optionally target specific files when possible).

Task:
{{task}}

Implementation:
{{implementation}}

Test Plan:
{{testPlan}}

Test Framework:
{{testFramework}}
