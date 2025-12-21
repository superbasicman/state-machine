/**
 * File: /lib/runtime/agent.js
 */

/**
 * Agent execution module for native JS workflows
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { getCurrentRuntime } from './runtime.js';

const require = createRequire(import.meta.url);

/**
 * Run an agent with context
 * @param {string} name - Agent name (file basename)
 * @param {object} params - Parameters passed to agent (default: {})
 * @param {object} options - Agent execution options (default: {})
 * @param {number|false} options.retry - Number of retries (default: 2, meaning 3 total attempts). Set to false to disable.
 * @param {string|string[]} options.steering - Additional steering files to load from steering/ folder
 */
export async function agent(name, params = {}, options = {}) {
  const runtime = getCurrentRuntime();
  if (!runtime) {
    throw new Error('agent() must be called within a workflow context');
  }

  // Parse retry option: default is 2 retries (3 total attempts)
  const retryCount = options.retry === false ? 0 : (options.retry ?? 2);

  let lastError;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`  [Agent: ${name}] Retry attempt ${attempt}/${retryCount}...`);
      } else {
        console.log(`  [Agent: ${name}] Starting...`);
      }

      const result = await executeAgent(runtime, name, params, options);

      if (result && typeof result === 'object' && result._debug_prompt) {
        delete result._debug_prompt;
      }

      console.log(`  [Agent: ${name}] Completed`);
      if (runtime._agentSuppressCompletion?.has(name)) {
        runtime._agentSuppressCompletion.delete(name);
        return result;
      }

      runtime.prependHistory({
        event: 'AGENT_COMPLETED',
        agent: name,
        output: result,
        attempts: attempt + 1
      });

      return result;
    } catch (error) {
      lastError = error;

      if (attempt < retryCount) {
        console.error(`  [Agent: ${name}] Error (attempt ${attempt + 1}/${retryCount + 1}): ${error.message}`);
        runtime.prependHistory({
          event: 'AGENT_RETRY',
          agent: name,
          attempt: attempt + 1,
          error: error.message
        });
      }
    }
  }

  // All retries exhausted - record failure
  runtime.prependHistory({
    event: 'AGENT_FAILED',
    agent: name,
    error: lastError.message,
    attempts: retryCount + 1
  });

  // Store error in accessible location (not auto-spread to context)
  runtime._agentErrors.push({
    agent: name,
    error: lastError.message,
    timestamp: new Date().toISOString()
  });

  throw lastError;
}

/**
 * Execute an agent (load and run)
 */
export async function executeAgent(runtime, name, params, options = {}) {
  const agentsDir = runtime.agentsDir;

  // Try JS agents (.js/.mjs/.cjs)
  const jsCandidates = [
    path.join(agentsDir, `${name}.js`),
    path.join(agentsDir, `${name}.mjs`),
    path.join(agentsDir, `${name}.cjs`)
  ];

  for (const p of jsCandidates) {
    if (fs.existsSync(p)) {
      return executeJSAgent(runtime, p, name, params, options);
    }
  }

  // Try Markdown agent
  const mdPath = path.join(agentsDir, `${name}.md`);
  if (fs.existsSync(mdPath)) {
    return executeMDAgent(runtime, mdPath, name, params, options);
  }

  throw new Error(
    `Agent not found: ${name} (looked for ${jsCandidates
      .map((p) => path.basename(p))
      .join(', ')} or ${name}.md in ${agentsDir})`
  );
}

/**
 * Execute a JavaScript agent
 * - ESM (.js/.mjs): loaded via dynamic import with cache-bust for hot reload
 * - CJS (.cjs): loaded via require() with cache clear
 */
async function executeJSAgent(runtime, agentPath, name, params, options = {}) {
  const ext = path.extname(agentPath).toLowerCase();

  let agentModule;
  if (ext === '.cjs') {
    // Clear require cache for hot reloading
    delete require.cache[require.resolve(agentPath)];
    agentModule = require(agentPath);
  } else {
    // Cache-busted import for hot reload behavior
    const url = pathToFileURL(agentPath).href;
    agentModule = await import(`${url}?t=${Date.now()}`);
  }

  const handler =
    agentModule?.handler ||
    agentModule?.default ||
    agentModule;

  if (typeof handler !== 'function') {
    throw new Error(`Agent ${name} does not export a function`);
  }

  logAgentStart(runtime, name);

  // Build steering context (global + any additional files from options)
  const steeringContext = options.steering
    ? runtime.loadSteeringFiles(options.steering)
    : runtime.steering;

  // Build context - only spread params, NOT memory (explicit context passing)
  const context = {
    ...params,
    _steering: steeringContext,
    _config: {
      models: runtime.workflowConfig.models,
      apiKeys: runtime.workflowConfig.apiKeys,
      workflowDir: runtime.workflowDir
    }
  };

  const result = await handler(context);

  // Handle interaction response from JS agent
  if (result && result._interaction) {
    const interactionResponse = await handleInteraction(runtime, result._interaction, name);
    
    // Use the interaction response as the primary output if it exists
    // This allows the workflow to receive the user's input directly
    if (typeof result === 'object') {
       // Merge response into result or replace? 
       // For consistency with MDAgent, we might want to return { result: response }
       // but JS agents are more flexible. 
       // Let's assume the agent wants the response mixed in or as the return.
       // A safe bet is to return the response if the agent explicitly asked for interaction.
       return { ...result, result: interactionResponse };
    }
    return interactionResponse;
  }

  // Clean internal properties from result
  if (result && typeof result === 'object') {
    const cleanResult = { ...result };
    delete cleanResult._steering;
    delete cleanResult._config;
    delete cleanResult._loop;
    delete cleanResult._interaction;

    // If agent returned a context-like object, only return non-internal keys
    const meaningfulKeys = Object.keys(cleanResult).filter((k) => !k.startsWith('_'));
    if (meaningfulKeys.length > 0) {
      const output = {};
      for (const key of meaningfulKeys) output[key] = cleanResult[key];
      return output;
    }

    return cleanResult;
  }

  return result;
}

/**
 * Execute a Markdown agent (prompt-based)
 */
async function executeMDAgent(runtime, agentPath, name, params, options = {}) {
  const { llm, buildPrompt, parseJSON, parseInteractionRequest } = await import('../llm.js');

  const content = fs.readFileSync(agentPath, 'utf-8');
  const { config, prompt } = parseMarkdownAgent(content);

  const outputKey = config.output || 'result';
  const targetKey = config.interactionKey || outputKey;

  // Combine steering from options (runtime call) and frontmatter (static)
  let steeringNames = [];

  if (options.steering) {
    const optSteering = Array.isArray(options.steering) ? options.steering : [options.steering];
    steeringNames.push(...optSteering);
  }

  if (config.steering) {
    const fmSteering = parseSteeringFrontmatter(config.steering);
    steeringNames.push(...fmSteering);
  }

  // Build steering context (global + any additional files)
  const steeringContext = steeringNames.length > 0
    ? runtime.loadSteeringFiles(steeringNames)
    : runtime.steering;

  // Build context - only spread params, NOT memory (explicit context passing)
  const context = {
    ...params,
    _steering: steeringContext,
    _config: {
      models: runtime.workflowConfig.models,
      apiKeys: runtime.workflowConfig.apiKeys,
      workflowDir: runtime.workflowDir
    }
  };

  // Interpolate variables in prompt
  const interpolatedPrompt = interpolatePrompt(prompt, context);

  const model = config.model || 'fast';

  const fullPrompt = buildPrompt(context, {
    model,
    prompt: interpolatedPrompt,
    includeContext: config.includeContext !== 'false'
  });

  logAgentStart(runtime, name, fullPrompt);

  console.log(`    Using model: ${model}`);

  const response = await llm(context, {
    model: model,
    prompt: interpolatedPrompt,
    includeContext: config.includeContext !== 'false'
  });

  // Parse output based on format
  let output = response.text;
  if (config.format === 'json') {
    try {
      output = parseJSON(response.text);
    } catch {
      console.warn(`    Warning: Failed to parse JSON output`);
    }
  }

  // Check for interaction request
  const explicitInteraction =
    config.format === 'interaction' ||
    config.interaction === 'true' ||
    (typeof config.interaction === 'string' && config.interaction.length > 0);

  const parsedInteraction = parseInteractionRequest(response.text);
  const structuredInteraction =
    config.autoInteract !== 'false' && parsedInteraction.isInteraction;

  if (explicitInteraction || structuredInteraction) {
    const slugRaw =
      (typeof config.interaction === 'string' && config.interaction !== 'true'
        ? config.interaction
        : null) ||
      config.interactionSlug ||
      config.interactionKey ||
      outputKey ||
      name;

    const slug = sanitizeSlug(slugRaw);
    const targetKey = config.interactionKey || outputKey || slug;
    const interactionContent = structuredInteraction ? parsedInteraction.question : response.text;

    const userResponse = await handleInteraction(runtime, {
      slug,
      targetKey,
      content: interactionContent
    }, name);

    // Return the user's response as the agent result
    return { [outputKey]: userResponse, _debug_prompt: response.fullPrompt };
  }

  // Return result object
  return { [outputKey]: output, _debug_prompt: response.fullPrompt };
}

/**
 * Parse markdown agent with simple frontmatter
 */
function parseMarkdownAgent(content) {
  // Frontmatter format:
  // ---
  // key: value
  // ---
  // prompt...
  if (content.startsWith('---')) {
    const parts = content.split('---');
    if (parts.length >= 3) {
      const frontmatter = parts[1].trim();
      const prompt = parts.slice(2).join('---').trim();

      const config = {};
      frontmatter.split('\n').forEach((line) => {
        const [key, ...rest] = line.split(':');
        if (key && rest.length) {
          const value = rest.join(':').trim();
          config[key.trim()] = value.replace(/^["']|["']$/g, '');
        }
      });

      return { config, prompt };
    }
  }

  return { config: {}, prompt: content.trim() };
}

/**
 * Parse steering value from frontmatter
 * Supports: "name", "name1, name2", "[name1, name2]", "['name1', 'name2']"
 * @param {string} value - Frontmatter steering value
 * @returns {string[]} Array of steering file names
 */
function parseSteeringFrontmatter(value) {
  if (!value) return [];

  const trimmed = value.trim();

  // Handle array format: [a, b, c] or ["a", "b", "c"]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    return inner.split(',')
      .map(s => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  // Handle comma-separated: a, b, c
  if (trimmed.includes(',')) {
    return trimmed.split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  // Single value
  return [trimmed];
}

/**
 * Interpolate {{variables}} in prompt template
 */
function interpolatePrompt(template, context) {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, pathStr) => {
    const value = getByPath(context, pathStr);
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Get nested value by dot-notation path
 */
function getByPath(obj, pathStr) {
  const trimmed = String(pathStr || '').trim();
  if (!trimmed) return undefined;

  const normalized = trimmed.startsWith('context.')
    ? trimmed.slice('context.'.length)
    : trimmed;

  const parts = normalized.split('.').filter(Boolean);
  let current = obj;

  for (const part of parts) {
    if (current == null) return undefined;
    current = current[String(part)];
  }

  return current;
}

function sanitizeSlug(input) {
  const raw = String(input || '').trim();
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned || 'interaction';
}

/**
 * Handle interaction (create file, wait for user, return response)
 */
async function handleInteraction(runtime, interaction, agentName) {
  const effectiveAgentName = typeof agentName === 'string' ? agentName : null;

  const slug = sanitizeSlug(interaction.slug);
  const targetKey = String(interaction.targetKey || slug);
  const content = String(interaction.content || '').trim();

  const filePath = path.join(runtime.interactionsDir, `${slug}.md`);

  // Create interaction file
  const fileContent = `<!-- Note: Edit this file directly and press 'y' in the terminal when finished. Safe to clear this file. -->
# ${slug}

${content}
`;

  fs.writeFileSync(filePath, fileContent);

  runtime.prependHistory({
    event: 'INTERACTION_REQUESTED',
    slug,
    targetKey,
    question: content
  });

  if (effectiveAgentName) {
    runtime._agentSuppressCompletion?.add(effectiveAgentName);
    runtime._agentResumeFlags?.add(effectiveAgentName);
  }

  // Block and wait for user input (instead of throwing)
  const response = await runtime.waitForInteraction(filePath, slug, targetKey);

  return response;
}

function logAgentStart(runtime, name, prompt) {
  if (runtime._agentResumeFlags?.has(name)) {
    runtime._agentResumeFlags.delete(name);
    runtime.prependHistory({
      event: 'AGENT_RESUMED',
      agent: name
    });
    return;
  }

  const entry = {
    event: 'AGENT_STARTED',
    agent: name
  };

  if (prompt) {
    entry.prompt = prompt;
  }

  runtime.prependHistory(entry);
}
