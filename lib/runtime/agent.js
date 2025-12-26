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
import { formatInteractionPrompt } from './interaction.js';
import { withChangeTracking } from './track-changes.js';

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
      await runtime.prependHistory({
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
        await runtime.prependHistory({
          event: 'AGENT_RETRY',
          agent: name,
          attempt: attempt + 1,
          error: error.message
        });
      }
    }
  }

  // All retries exhausted - record failure
  await runtime.prependHistory({
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

  await logAgentStart(runtime, name);

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
      workflowDir: runtime.workflowDir,
      projectRoot: runtime.workflowConfig.projectRoot
    }
  };

  // Execute handler with optional file change tracking
  const executeHandler = async () => {
    let result = await handler(context);
    let interactionDepth = 0;

    // Handle interaction response from JS agent (support multiple rounds)
    while (result && result._interaction) {
      const interactionResponse = await handleInteraction(runtime, result._interaction, name);
      const resumedContext = { ...context, userResponse: interactionResponse };
      await logAgentStart(runtime, name);
      result = await handler(resumedContext);
      interactionDepth += 1;
      if (interactionDepth > 5) {
        throw new Error(`Agent ${name} exceeded maximum interaction depth`);
      }
    }

    return result;
  };

  let result;
  if (runtime.workflowConfig.fileTracking !== false) {
    result = await withChangeTracking(runtime, name, executeHandler);
  } else {
    result = await executeHandler();
  }

  // Clean internal properties from result
  if (result && typeof result === 'object') {
    const cleanResult = { ...result };
    delete cleanResult._steering;
    delete cleanResult._config;
    delete cleanResult._loop;
    delete cleanResult._interaction;
    delete cleanResult._files;

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

  const outputKey = config.output;

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

  // Build base config (used for all iterations)
  const baseConfig = {
    models: runtime.workflowConfig.models,
    apiKeys: runtime.workflowConfig.apiKeys,
    workflowDir: runtime.workflowDir,
    projectRoot: runtime.workflowConfig.projectRoot
  };

  // Execute the MD agent core logic
  const executeMDAgentCore = async () => {
    let response = null;
    let output = null;
    let interactionDepth = 0;
    let currentParams = params;

    while (true) {
      // Build context - only spread params, NOT memory (explicit context passing)
      const context = {
        ...currentParams,
        _steering: steeringContext,
        _config: baseConfig
      };

      // Interpolate variables in prompt
      const interpolatedPrompt = interpolatePrompt(prompt, context);

      const model = config.model || 'fast';

      const fullPrompt = buildPrompt(context, {
        model,
        prompt: interpolatedPrompt,
        includeContext: config.includeContext !== 'false',
        responseType: config.response
      });

      await logAgentStart(runtime, name, fullPrompt);

      console.log(`    Using model: ${model}`);

      response = await llm(context, {
        model: model,
        prompt: interpolatedPrompt,
        includeContext: config.includeContext !== 'false',
        responseType: config.response
      });

      // Parse output based on format
      output = response.text;
      if (config.format === 'json') {
        try {
          output = parseJSON(response.text);
        } catch {
          console.warn(`    Warning: Failed to parse JSON output`);
        }
      }

      if (output && typeof output === 'object' && output._interaction) {
        const interactionResponse = await handleInteraction(runtime, output._interaction, name);
        currentParams = { ...params, userResponse: interactionResponse };
        interactionDepth += 1;
        if (interactionDepth > 5) {
          throw new Error(`Agent ${name} exceeded maximum interaction depth`);
        }
        continue;
      }

      break;
    }

    // Check for interaction request
    const parsedInteraction = parseInteractionRequest(response.text);
    const structuredInteraction =
      config.autoInteract !== 'false' && parsedInteraction.isInteraction;

    // Check if agent returned an 'interact' object in its JSON response
    const hasInteractKey = output && typeof output === 'object' && output.interact;

    // Explicit interaction mode (format: interaction OR interaction: true)
    // But only trigger if agent actually wants to interact (has interact key or parsed interaction)
    const explicitInteraction =
      config.format === 'interaction' ||
      ((config.interaction === 'true' || (typeof config.interaction === 'string' && config.interaction.length > 0)) &&
        (hasInteractKey || structuredInteraction));

    if (explicitInteraction || structuredInteraction) {
      // Use interact object if present, otherwise fall back to parsed/raw
      const interactionData = hasInteractKey ? output.interact : (structuredInteraction ? parsedInteraction : null);

      const slugRaw =
        interactionData?.slug ||
        (typeof config.interaction === 'string' && config.interaction !== 'true'
          ? config.interaction
          : null) ||
        config.interactionSlug ||
        config.interactionKey ||
        name;

      const slug = sanitizeSlug(slugRaw);
      const targetKey = config.interactionKey || outputKey || slug;

      // Build interaction object with full metadata
      const interactionObj = hasInteractKey ? {
        ...output.interact,
        slug,
        targetKey
      } : {
        slug,
        targetKey,
        content: structuredInteraction ? parsedInteraction.question : response.text
      };

      const userResponse = await handleInteraction(runtime, interactionObj, name);

      // Return the user's response as the agent result
      if (outputKey) {
        return { [outputKey]: userResponse, _debug_prompt: response.fullPrompt };
      }

      return userResponse;
    }

    // Return result object
    if (outputKey) {
      return { [outputKey]: output, _debug_prompt: response.fullPrompt };
    }

    return output;
  };

  // Execute with optional file change tracking
  if (runtime.workflowConfig.fileTracking !== false) {
    return withChangeTracking(runtime, name, executeMDAgentCore);
  } else {
    return executeMDAgentCore();
  }
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
  const prompt = String(
    interaction.prompt ??
    interaction.content ??
    interaction.question ??
    ''
  ).trim();
  const content = formatInteractionPrompt({
    ...interaction,
    prompt
  });

  const filePath = path.join(runtime.interactionsDir, `${slug}.md`);

  // Create interaction file
  const fileContent = `<!-- Note: Edit this file directly and press 'y' in the terminal when finished. Safe to clear this file. -->
# ${slug}

${content}
`;

  fs.writeFileSync(filePath, fileContent);

  await runtime.prependHistory({
    event: 'INTERACTION_REQUESTED',
    slug,
    targetKey,
    type: interaction.type || 'text',
    prompt: prompt || content,
    options: interaction.options,
    allowCustom: interaction.allowCustom,
    multiSelect: interaction.multiSelect,
    placeholder: interaction.placeholder,
    validation: interaction.validation,
    confirmLabel: interaction.confirmLabel,
    cancelLabel: interaction.cancelLabel,
    context: interaction.context,
    // Include full-auto info for remote UI countdown
    fullAuto: runtime.workflowConfig.fullAuto || false,
    autoSelectDelay: runtime.workflowConfig.autoSelectDelay ?? 20
  });

  if (effectiveAgentName) {
    runtime._agentResumeFlags?.add(effectiveAgentName);
  }

  // Block and wait for user input (instead of throwing)
  // Pass the full interaction object for full-auto mode support
  const response = await runtime.waitForInteraction(filePath, slug, targetKey, interaction);

  return response;
}

async function logAgentStart(runtime, name, prompt) {
  if (runtime._agentResumeFlags?.has(name)) {
    runtime._agentResumeFlags.delete(name);
    await runtime.prependHistory({
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

  await runtime.prependHistory(entry);
}
