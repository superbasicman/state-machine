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
 * @param {object} params - Parameters passed to agent
 */
export async function agent(name, params = {}) {
  const runtime = getCurrentRuntime();
  if (!runtime) {
    throw new Error('agent() must be called within a workflow context');
  }

  console.log(`  [Agent: ${name}] Starting...`);
  runtime.prependHistory({
    event: 'AGENT_STARTED',
    agent: name
  });

  try {
    const result = await executeAgent(runtime, name, params);

    let prompt = undefined;
    if (result && typeof result === 'object' && result._debug_prompt) {
      prompt = result._debug_prompt;
      delete result._debug_prompt;
    }

    console.log(`  [Agent: ${name}] Completed`);
    runtime.prependHistory({
      event: 'AGENT_COMPLETED',
      agent: name,
      output: result,
      prompt: prompt
    });

    return result;
  } catch (error) {
    runtime.prependHistory({
      event: 'AGENT_FAILED',
      agent: name,
      error: error.message
    });
    throw error;
  }
}

/**
 * Execute an agent (load and run)
 */
export async function executeAgent(runtime, name, params) {
  const agentsDir = runtime.agentsDir;

  // Try JS agents (.js/.mjs/.cjs)
  const jsCandidates = [
    path.join(agentsDir, `${name}.js`),
    path.join(agentsDir, `${name}.mjs`),
    path.join(agentsDir, `${name}.cjs`)
  ];

  for (const p of jsCandidates) {
    if (fs.existsSync(p)) {
      return executeJSAgent(runtime, p, name, params);
    }
  }

  // Try Markdown agent
  const mdPath = path.join(agentsDir, `${name}.md`);
  if (fs.existsSync(mdPath)) {
    return executeMDAgent(runtime, mdPath, name, params);
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
async function executeJSAgent(runtime, agentPath, name, params) {
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

  // Build context
  const context = {
    ...runtime._rawMemory,
    ...params,
    _steering: runtime.steering,
    _config: {
      models: runtime.workflowConfig.models,
      apiKeys: runtime.workflowConfig.apiKeys,
      workflowDir: runtime.workflowDir
    }
  };

  const result = await handler(context);

  // Handle interaction response from JS agent
  if (result && result._interaction) {
    const interactionResponse = await handleInteraction(runtime, result._interaction);
    
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
async function executeMDAgent(runtime, agentPath, name, params) {
  const { llm, parseJSON, parseInteractionRequest } = await import('../llm.js');

  const content = fs.readFileSync(agentPath, 'utf-8');
  const { config, prompt } = parseMarkdownAgent(content);

  const outputKey = config.output || 'result';
  const targetKey = config.interactionKey || outputKey;

  // Build context
  const context = {
    ...runtime._rawMemory,
    ...params,
    _steering: runtime.steering,
    _config: {
      models: runtime.workflowConfig.models,
      apiKeys: runtime.workflowConfig.apiKeys,
      workflowDir: runtime.workflowDir
    }
  };

  // Interpolate variables in prompt
  const interpolatedPrompt = interpolatePrompt(prompt, context);

  const model = config.model || 'fast';

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
    });

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
async function handleInteraction(runtime, interaction) {
  const slug = sanitizeSlug(interaction.slug);
  const targetKey = String(interaction.targetKey || slug);
  const content = String(interaction.content || '').trim();

  const filePath = path.join(runtime.interactionsDir, `${slug}.md`);

  // Create interaction file
  const fileContent = `# ${slug}

${content}

---
Enter your response below:

`;

  fs.writeFileSync(filePath, fileContent);

  runtime.prependHistory({
    event: 'INTERACTION_REQUESTED',
    slug,
    targetKey,
    question: content
  });

  // Block and wait for user input (instead of throwing)
  const response = await runtime.waitForInteraction(filePath, slug, targetKey);

  return response;
}
