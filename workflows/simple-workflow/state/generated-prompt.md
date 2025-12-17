# Current Context

```json

{
  "_yoda-collector_model": "claude --model claude-sonnet-4-20250514 -p",
  "greeting": "my first name is jonnathon by people call me jon"
}

```

---

# Interaction Format

IF YOU NEED TO ASK THE USER A QUESTION OR REQUEST INPUT, RESPOND WITH EXACTLY:

{ "interact": "your question here" }


Only use this format when you genuinely need user input to proceed.

---

# System Instructions

## Context

You are part of the "simple-workflow" workflow. Follow these guidelines:

- Process data carefully and validate inputs
- Return well-structured JSON when applicable
- Log meaningful progress messages
- Handle errors gracefully

## Variables

Collect whatever context you can from the context section above.

## Guidelines

Add your global instructions, constraints, or personas here. This file is automatically
loaded and passed to every agent in the workflow via `context._steering.global`.


---

# Task


# Greeting Task

Generate a friendly greeting for {{name}} in a yoda style. Prompt user for their actual {{name}} if you dont have it.

Once you have it create a yoda-greeting.md file with the greeting.