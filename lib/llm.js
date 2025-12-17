const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

/**
 * LLM Helper Module
 *
 * Supports both CLI tools (claude, gemini, codex) and APIs (anthropic, openai)
 *
 * Usage:
 *   const { llm } = require('agent-state-machine/llm');
 *   const response = await llm(context, { model: 'smart', prompt: 'Hello' });
 */

/**
 * Detect available CLI tools
 */
function detectAvailableCLIs() {
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
 * Write the generated prompt file
 */
function writeGeneratedPrompt(workflowDir, content) {
  const promptDir = path.join(workflowDir, 'state');
  const promptFile = path.join(promptDir, 'generated-prompt.md');

  if (!fs.existsSync(promptDir)) {
    fs.mkdirSync(promptDir, { recursive: true });
  }

  fs.writeFileSync(promptFile, content);
  return promptFile;
}

/**
 * Build the full prompt with steering and context
 */
function buildPrompt(context, options) {
  const parts = [];

  // Add context summary if requested
  if (options.includeContext !== false) {
    const cleanContext = { ...context };
    delete cleanContext._steering;
    delete cleanContext._loop;
    delete cleanContext._config;

    if (Object.keys(cleanContext).length > 0) {
      parts.push('# Current Context\n');
      parts.push('```json\n');
      parts.push(JSON.stringify(cleanContext, null, 2));
      parts.push('\n```\n\n---\n');
    }
  }

  // Add interaction format instruction
  parts.push('# Interaction Format\n');
  parts.push('IF YOU NEED TO ASK THE USER A QUESTION OR REQUEST INPUT, RESPOND WITH EXACTLY:\n');
  parts.push('{ "interact": "your question here" }\n\n');
  parts.push('Only use this format when you genuinely need user input to proceed.\n\n---\n');

  // Add global steering if available
  if (context._steering?.global) {
    parts.push('# System Instructions\n');
    parts.push(context._steering.global);
    parts.push('\n---\n');
  }

  // Add the actual prompt
  parts.push('# Task\n\n');
  parts.push(options.prompt);

  return parts.join('\n');
}

/**
 * Execute CLI command and return response
 */
async function executeCLI(command, promptFile, options = {}) {
  return new Promise((resolve, reject) => {
    // Parse command to extract base command and args
    // Note: naive split; if you need quoted args, consider a shell-args parser.
    const parts = command.split(' ');
    const baseCmd = parts[0];
    const baseArgs = parts.slice(1);

    // Build full args
    const args = [...baseArgs];

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

      // Insert `exec` after any leading global options so codex doesn't start interactive mode.
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

    // Different CLIs handle file input differently
    if (baseCmd === 'claude') {
      // Claude CLI: use stdin for prompt input
      args.push('--print'); // Print response only
      args.push('--permission-mode', 'acceptEdits');
      // File content will be piped via stdin (no additional args needed)
    } else if (baseCmd === 'gemini') {
      // Gemini CLI - adjust as needed for actual CLI
      args.push('-f', promptFile);
    } else if (baseCmd === 'codex') {
      // Codex CLI defaults to an interactive TUI, which requires a TTY.
      // Force non-interactive mode via `codex exec`, and feed PROMPT via stdin ("-").
      ensureCodexExec();

      // Write only the final message to a file to avoid parsing extra output.
      const lastMessageFile = path.join(
        path.dirname(promptFile),
        `codex-last-message-${process.pid}-${Date.now()}.txt`
      );
      args.push('--output-last-message', lastMessageFile);

      args.push('-');
    } else {
      // Generic: try passing file as argument
      args.push(promptFile);
    }

    console.log(`  [LLM] Running: ${baseCmd} ${args.join(' ')}`);

    const child = spawn(baseCmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });

    // Feed stdin for Codex and Claude from the prompt file; otherwise close stdin.
    if (baseCmd === 'codex' || baseCmd === 'claude') {
      fs.createReadStream(promptFile).pipe(child.stdin);
    } else {
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
    // Dynamic import to avoid requiring the package if not used
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
 * @param {string} options.model - Model key from workflow.js models config
 * @param {string} options.prompt - The prompt to send
 * @param {boolean} options.includeContext - Whether to include context in prompt (default: true)
 * @param {number} options.maxTokens - Max tokens for API calls (default: 4096)
 * @param {string} options.workflowDir - Workflow directory (usually from context)
 *
 * @returns {Promise<{text: string, model: string, provider: string, usage: object|null}>}
 */
async function llm(context, options) {
  if (!options.prompt) {
    throw new Error('llm() requires a prompt');
  }

  if (!options.model) {
    throw new Error('llm() requires a model key');
  }

  const config = context._config || {};
  const models = config.models || {};
  const apiKeys = config.apiKeys || {};
  const workflowDir = config.workflowDir || process.cwd();

  // Look up the model command/config
  const modelConfig = models[options.model];

  if (!modelConfig) {
    const available = Object.keys(models).join(', ');
    throw new Error(
      `Unknown model key: "${options.model}". Available models: ${available || 'none defined'}`
    );
  }

  // Build the full prompt
  const fullPrompt = buildPrompt(context, options);

  // Write to generated-prompt.md
  const promptFile = writeGeneratedPrompt(workflowDir, fullPrompt);
  console.log(`  [LLM] Prompt written to: ${promptFile}`);

  // Check if it's an API call or CLI
  if (modelConfig.startsWith('api:')) {
    // Format: api:provider:model
    const parts = modelConfig.split(':');
    const provider = parts[1];
    const model = parts.slice(2).join(':');

    const apiKey = apiKeys[provider] || process.env[`${provider.toUpperCase()}_API_KEY`];

    if (!apiKey) {
      throw new Error(
        `No API key found for ${provider}. Set in workflow.js apiKeys or ${provider.toUpperCase()}_API_KEY env var`
      );
    }

    return executeAPI(provider, model, fullPrompt, apiKey, options);
  }

  // CLI execution
  return executeCLI(modelConfig, promptFile, options);
}

/**
 * Simple wrapper that just returns the text
 */
async function llmText(context, options) {
  const response = await llm(context, options);
  return response.text;
}

/**
 * Parse interaction request from LLM response
 * Detects { "interact": "question" } pattern in various formats
 * @param {string} text - The LLM response text
 * @returns {{ isInteraction: boolean, question?: string }}
 */
function parseInteractionRequest(text) {
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
function parseJSON(text) {
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

  const arrayMatch = text.match(/\[[\s\S]*\]/);
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
async function llmJSON(context, options) {
  const response = await llm(context, {
    ...options,
    prompt: options.prompt + '\n\nRespond with valid JSON only, no other text.'
  });

  return {
    ...response,
    data: parseJSON(response.text)
  };
}

module.exports = {
  llm,
  llmText,
  llmJSON,
  parseJSON,
  parseInteractionRequest,
  detectAvailableCLIs,
  buildPrompt,
  writeGeneratedPrompt
};
