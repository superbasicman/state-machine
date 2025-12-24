/**
 * File: /lib/llm.js
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execSync } from 'child_process';
import { createRequire } from 'module';
import { getCurrentRuntime } from './runtime/runtime.js';
import { resolveUnknownModel } from './runtime/model-resolution.js';

const require = createRequire(import.meta.url);

/**
 * LLM Helper Module
 *
 * Supports both CLI tools (claude, gemini, codex) and APIs (anthropic, openai)
 *
 * Usage:
 *   import { llm } from 'agent-state-machine';
 *   const response = await llm(context, { model: 'smart', prompt: 'Hello' });
 */

/**
 * Detect available CLI tools
 */
export function detectAvailableCLIs() {
  const clis = ['claude', 'gemini', 'codex', 'ollama'];
  const available = {};

  for (const cli of clis) {
    try {
      execSync(`which ${cli}`, { stdio: 'ignore' });
      available[cli] = true;
    } catch {
      available[cli] = false;
    }
  }

  return available;
}

/**
 * Get response format instructions based on response type
 * Used by buildPrompt to inject appropriate interaction format instructions
 */
function getResponseFormatInstructions(responseType) {
  if (responseType === 'choice') {
    return `# Response Format

When you need user input, respond with a structured choice:

{
  "interact": {
    "type": "choice",
    "slug": "unique-slug",
    "prompt": "Your question here?",
    "options": [
      { "key": "key1", "label": "Display Label", "description": "Help text" }
    ],
    "multiSelect": false,
    "allowCustom": true
  }
}

Rules:
- slug: unique identifier (e.g., "scope-platform")
- options: 2-5 choices with key, label, and optional description
- multiSelect: true allows selecting multiple options
- allowCustom: true shows "Other" for free-text input
- Ask ONE question at a time
`;
  }

  if (responseType === 'confirm') {
    return `# Response Format

When you need user confirmation, respond with:

{
  "interact": {
    "type": "confirm",
    "slug": "unique-slug",
    "prompt": "Are you sure about X?",
    "confirmLabel": "Yes, proceed",
    "cancelLabel": "No, cancel"
  }
}
`;
  }

  if (responseType === 'text') {
    return `# Response Format

When you need text input, respond with:

{
  "interact": {
    "type": "text",
    "slug": "unique-slug",
    "prompt": "Please describe X:",
    "placeholder": "Enter details...",
    "validation": { "minLength": 10 }
  }
}
`;
  }

  // Default: basic interact format
  return `# Interaction Format
IF YOU NEED TO ASK THE USER A QUESTION OR REQUEST INPUT, RESPOND WITH EXACTLY:
{ "interact": "your question here" }

Only use this format when you genuinely need user input to proceed.
`;
}

/**
 * Build the full prompt with steering and context
 */
export function buildPrompt(context, options) {
  const parts = [];

  // Add context summary if requested
  if (options.includeContext !== false) {
    const cleanContext = { ...context };
    delete cleanContext._steering;
    delete cleanContext._loop;
    delete cleanContext._config;
    delete cleanContext._memory;

    // Add the actual prompt
    parts.push('# Task\n\n');
    parts.push(options.prompt);

    if (Object.keys(cleanContext).length > 0) {
      parts.push('# Current Context\n');
      parts.push('```json\n');
      parts.push(JSON.stringify(cleanContext, null, 2));
      parts.push('\n```\n\n---\n');
    }
  }

  // Add response format instructions (based on responseType option)
  parts.push(getResponseFormatInstructions(options.responseType));
  parts.push('\n---\n');

  // Add global steering if available (always first)
  if (context._steering?.global) {
    parts.push('# System Instructions\n');
    parts.push(context._steering.global);
    parts.push('\n---\n');
  }

  // Add additional steering files if available
  if (context._steering?.additional && context._steering.additional.length > 0) {
    parts.push('# Additional Guidelines\n');
    for (const content of context._steering.additional) {
      parts.push(content);
      parts.push('\n---\n');
    }
  }

  return parts.join('\n');
}

/**
 * Execute CLI command and return response
 * Uses Stdin for supported tools, and temporary files for generic tools.
 */
async function executeCLI(command, promptText, options = {}, apiKeys = {}) {
  return new Promise((resolve, reject) => {
    // Parse command to extract base command and args
    const parts = command.split(' ');
    const baseCmd = parts[0];
    const baseArgs = parts.slice(1);

    // Build full args
    const args = [...baseArgs];
    let tempPromptFile = null;

    const ensureCodexExec = () => {
      const CODEX_SUBCOMMANDS = new Set([
        'exec', 'e',
        'review',
        'login', 'logout',
        'mcp', 'mcp-server',
        'app-server',
        'completion',
        'sandbox', 'debug',
        'apply', 'a',
        'resume',
        'cloud',
        'features',
        'help'
      ]);

      const optionsWithValues = new Set([
        '-c', '--config',
        '--enable', '--disable',
        '-i', '--image',
        '-m', '--model',
        '-p', '--profile',
        '-s', '--sandbox',
        '-a', '--ask-for-approval',
        '-C', '--cd',
        '--local-provider',
        '--add-dir',
        '--color',
        '--output-schema',
        '-o', '--output-last-message'
      ]);

      // Insert `exec` after any leading global options
      let i = 0;
      while (i < args.length) {
        const token = args[i];
        if (!token.startsWith('-')) break;

        if (optionsWithValues.has(token)) {
          i += 2;
          continue;
        }
        i += 1;
      }

      const firstNonOption = args[i];
      if (firstNonOption && CODEX_SUBCOMMANDS.has(firstNonOption)) {
        return;
      }
      args.splice(i, 0, 'exec');
    };

    // Configure args based on the tool
    const isStandardCLI = (baseCmd === 'claude' || baseCmd === 'gemini' || baseCmd === 'codex');

    if (baseCmd === 'claude') {
      args.push('--print');
      args.push('--permission-mode', 'acceptEdits');
      // Input via stdin
    } else if (baseCmd === 'gemini') {
      args.push('--approval-mode', 'auto_edit');
      // Input via stdin
    } else if (baseCmd === 'codex') {
      ensureCodexExec();
      const lastMessageFile = path.join(
        os.tmpdir(),
        `codex-last-message-${process.pid}-${Date.now()}.txt`
      );
      args.push('--output-last-message', lastMessageFile);
      args.push('-'); // Explicitly read from stdin
    } else {
      // Generic CLI: Fallback to temp file if not a known stdin consumer
      // We assume generic tools might expect a filename as an argument.
      const uniqueId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      tempPromptFile = path.join(os.tmpdir(), `asm-prompt-${uniqueId}.md`);
      fs.writeFileSync(tempPromptFile, promptText);
      args.push(tempPromptFile);
    }

    console.log(`  [LLM] Running: ${baseCmd} ${args.join(' ')}`);

    const env = { ...process.env };
    if (apiKeys.gemini) env.GEMINI_API_KEY = apiKeys.gemini;
    if (apiKeys.anthropic) env.ANTHROPIC_API_KEY = apiKeys.anthropic;
    if (apiKeys.openai) env.OPENAI_API_KEY = apiKeys.openai;

    const child = spawn(baseCmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env
    });

    // Write prompt to stdin if it's a standard tool or we decided to use stdin
    if (isStandardCLI) {
      child.stdin.write(promptText);
      child.stdin.end();
    } else {
      // For generic tools using temp files, just close stdin
      child.stdin.end();
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      // Cleanup temp file if used
      if (tempPromptFile && fs.existsSync(tempPromptFile)) {
        try { fs.unlinkSync(tempPromptFile); } catch {}
      }

      if (code === 0) {
        if (baseCmd === 'codex') {
          const outputFlagIndex = args.findIndex(a => a === '--output-last-message' || a === '-o');
          const outputFile = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : null;
          if (outputFile && fs.existsSync(outputFile)) {
            try {
              stdout = fs.readFileSync(outputFile, 'utf-8');
            } finally {
              try { fs.unlinkSync(outputFile); } catch {}
            }
          }
        }

        resolve({
          text: stdout.trim(),
          model: command,
          provider: 'cli',
          usage: null
        });
      } else {
        reject(new Error(`CLI command failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    child.on('error', (err) => {
      // Cleanup temp file if used
      if (tempPromptFile && fs.existsSync(tempPromptFile)) {
        try { fs.unlinkSync(tempPromptFile); } catch {}
      }
      reject(new Error(`Failed to execute CLI: ${err.message}`));
    });
  });
}

/**
 * Execute API call and return response
 */
async function executeAPI(provider, model, prompt, apiKey, options = {}) {
  console.log(`  [LLM] Calling API: ${provider}/${model}`);

  if (provider === 'anthropic') {
    let Anthropic;
    try {
      Anthropic = require('@anthropic-ai/sdk');
    } catch {
      throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk');
    }

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: model,
      max_tokens: options.maxTokens || 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    return {
      text: response.content[0].text,
      model: model,
      provider: 'anthropic',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      }
    };
  }

  if (provider === 'openai') {
    let OpenAI;
    try {
      OpenAI = require('openai');
    } catch {
      throw new Error('OpenAI SDK not installed. Run: npm install openai');
    }

    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create({
      model: model,
      max_tokens: options.maxTokens || 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    return {
      text: response.choices[0].message.content,
      model: model,
      provider: 'openai',
      usage: {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens
      }
    };
  }

  throw new Error(`Unknown API provider: ${provider}`);
}

/**
 * Main LLM function
 *
 * @param {object} context - The workflow context (contains _config, _steering, etc.)
 * @param {object} options - Options for the LLM call
 * @param {string} options.model - Model key from config.js models config
 * @param {string} options.prompt - The prompt to send
 * @param {boolean} options.includeContext - Whether to include context in prompt (default: true)
 * @param {number} options.maxTokens - Max tokens for API calls (default: 4096)
 * @param {string} options.workflowDir - Workflow directory (usually from context)
 *
 * @returns {Promise<{text: string, model: string, provider: string, usage: object|null}>}
 */
export async function llm(context, options) {
  if (!options.prompt) {
    throw new Error('llm() requires a prompt');
  }

  if (!options.model) {
    throw new Error('llm() requires a model key');
  }

  const config = context._config || {};
  const models = config.models || {};
  const apiKeys = config.apiKeys || {};
  
  // Look up the model command/config
  let modelConfig = models[options.model];

  if (!modelConfig) {
    const runtime = getCurrentRuntime();
    if (runtime) {
      const workflowDir = options.workflowDir || config.workflowDir || runtime.workflowDir;
      if (!workflowDir) {
        throw new Error(`Unknown model key: "${options.model}". Workflow directory is missing.`);
      }
      modelConfig = await resolveUnknownModel(options.model, config, workflowDir, {
        availableCLIs: detectAvailableCLIs()
      });
      if (!config.models) {
        config.models = models;
      }
      config.models[options.model] = modelConfig;
      runtime.workflowConfig.models[options.model] = modelConfig;
    } else {
      const available = Object.keys(models).join(', ');
      throw new Error(
        `Unknown model key: "${options.model}". Available models: ${available || 'none defined'}`
      );
    }
  }

  // Build the full prompt
  const fullPrompt = buildPrompt(context, options);

  // Check if it's an API call or CLI
  let result;
  if (modelConfig.startsWith('api:')) {
    const parts = modelConfig.split(':');
    const provider = parts[1];
    const model = parts.slice(2).join(':');

    const apiKey = apiKeys[provider] || process.env[`${provider.toUpperCase()}_API_KEY`];

    if (!apiKey) {
      throw new Error(
        `No API key found for ${provider}. Set in config.js apiKeys or ${provider.toUpperCase()}_API_KEY env var`
      );
    }

    result = await executeAPI(provider, model, fullPrompt, apiKey, options);
  } else {
    // CLI execution - pass fullPrompt string directly
    result = await executeCLI(modelConfig, fullPrompt, options, apiKeys);
  }

  return { ...result, fullPrompt };
}

/**
 * Simple wrapper that just returns the text
 */
export async function llmText(context, options) {
  const response = await llm(context, options);
  return response.text;
}

/**
 * Parse interaction request from LLM response
 * Detects { "interact": "question" } pattern in various formats
 * @param {string} text - The LLM response text
 * @returns {{ isInteraction: boolean, question?: string }}
 */
export function parseInteractionRequest(text) {
  if (!text || typeof text !== 'string') {
    return { isInteraction: false };
  }

  // Match { "interact": "..." } with various formatting
  // Supports: quoted/unquoted key, with/without spaces
  const pattern = /\{\s*"?interact"?\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/;
  const match = text.match(pattern);

  if (match && match[1]) {
    const question = match[1]
      .replace(/\\n/g, '\n')   // Unescape newlines
      .replace(/\\"/g, '"')    // Unescape quotes
      .replace(/\\\\/g, '\\')  // Unescape backslashes
      .trim();

    if (question.length > 0) {
      return { isInteraction: true, question };
    }
  }

  return { isInteraction: false };
}

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
export function parseJSON(text) {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {}

  // Try extracting from markdown code block
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {}
  }

  // Try finding JSON object/array in text
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {}
  }

  const arrayMatch = text.match(/\{[\[\s\S]*\]\}/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {}
  }

  throw new Error('Could not parse JSON from LLM response');
}

/**
 * LLM call that expects JSON response
 */
export async function llmJSON(context, options) {
  const response = await llm(context, {
    ...options,
    prompt: options.prompt + '\n\nRespond with valid JSON only, no other text.'
  });

  return {
    ...response,
    data: parseJSON(response.text)
  };
}
