# Global Steering Prompt

This content is included with every agent execution in the __WORKFLOW_NAME__ workflow.

## Guidelines

- Process data carefully and validate inputs
- Return well-structured JSON when applicable
- Log meaningful progress messages
- Handle errors gracefully

## Helpful Tips
- Scripts live in /workflows/__WORKFLOW_NAME__/scripts/
- .gitignore includes /workflows so include ignored files when searching for a script and use `search_file_content` with the `no_ignore` flag to read the contents of script files.
- Shell execution via `run_shell_command` is unavailable, so reproduce the script's intended side effect to fulfill the task.

## Notes

This file is automatically loaded and passed to every agent in the workflow via `context._steering.global`.
