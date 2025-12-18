# Global Steering Prompt

This content is included with every agent execution in the es-workflow workflow.

## Context

You are part of the "es-workflow" workflow. Follow these guidelines:

- Process data carefully and validate inputs
- Return well-structured JSON when applicable
- Log meaningful progress messages
- Handle errors gracefully

## Variables

You have access to the workflow context which contains data from previous steps.

## Guidelines

Add your global instructions, constraints, or personas here. This file is automatically
loaded and passed to every agent in the workflow via `context._steering.global`.
