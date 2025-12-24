/**
 * File: /lib/runtime/model-resolution.js
 */

import fs from 'fs';
import path from 'path';
import { askHuman } from './prompt.js';
import { createInteraction, parseInteractionResponse } from './interaction.js';
import { readModelFromConfig, writeModelToConfig } from '../config-utils.js';

function sanitizeSlug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 40) || 'model';
}

export function buildModelSuggestions(availableCLIs = {}, existingModels = {}) {
  const options = [];
  const lookup = {};

  const addOption = (key, label, description, value) => {
    options.push({ key, label, description });
    lookup[key] = value;
  };

  Object.entries(existingModels).forEach(([key, value]) => {
    const optionKey = `existing:${key}`;
    const description = value ? `Maps to "${value}"` : 'Existing model mapping';
    addOption(optionKey, `Use existing model: ${key}`, description, value);
  });

  if (availableCLIs.claude) {
    addOption('cli:claude', 'claude -p', 'Claude CLI (print mode)', 'claude -p');
  }
  if (availableCLIs.gemini) {
    addOption('cli:gemini', 'gemini', 'Gemini CLI', 'gemini');
  }
  if (availableCLIs.codex) {
    addOption('cli:codex', 'codex', 'Codex CLI (exec)', 'codex');
  }
  if (availableCLIs.ollama) {
    addOption('cli:ollama', 'ollama run llama3.1', 'Ollama CLI (example model)', 'ollama run llama3.1');
  }

  addOption(
    'api:openai',
    'api:openai:gpt-4.1-mini',
    'OpenAI API (example model)',
    'api:openai:gpt-4.1-mini'
  );
  addOption(
    'api:anthropic',
    'api:anthropic:claude-3-5-sonnet-20241022',
    'Anthropic API (example model)',
    'api:anthropic:claude-3-5-sonnet-20241022'
  );

  return { options, lookup };
}

export async function promptForModelConfig(modelKey, existingModels = {}, availableCLIs = {}) {
  const existingKeys = Object.keys(existingModels);
  const existingSummary = existingKeys.length > 0
    ? `Existing models: ${existingKeys.join(', ')}`
    : 'No models configured yet.';

  const { options, lookup } = buildModelSuggestions(availableCLIs, existingModels);
  const prompt = `Unknown model key: "${modelKey}"\n\nHow would you like to configure this model?\n${existingSummary}`;
  const slug = `model-${sanitizeSlug(modelKey)}`;
  const interaction = createInteraction('choice', slug, {
    prompt,
    options,
    allowCustom: true,
    multiSelect: false
  });

  const answer = await askHuman(prompt, { slug, interaction });
  const parsed = await parseInteractionResponse(interaction, answer);

  if (parsed.isCustom && parsed.customText) {
    return parsed.customText.trim();
  }

  if (parsed.selectedKey) {
    const mapped = lookup[parsed.selectedKey];
    if (mapped) return mapped;
    return String(parsed.selectedKey).trim();
  }

  if (typeof parsed.text === 'string' && parsed.text.trim()) {
    return parsed.text.trim();
  }

  if (typeof parsed.raw === 'string' && parsed.raw.trim()) {
    return parsed.raw.trim();
  }

  throw new Error('No model configuration provided.');
}

export async function resolveUnknownModel(modelKey, config, workflowDir, options = {}) {
  if (!workflowDir) {
    throw new Error('Cannot resolve model without a workflow directory.');
  }

  const configFile = path.join(workflowDir, 'config.js');
  if (!fs.existsSync(configFile)) {
    throw new Error(`config.js not found in ${workflowDir}`);
  }

  const existing = readModelFromConfig(configFile, modelKey);
  if (existing) {
    return existing;
  }

  const existingModels = config?.models || {};
  const availableCLIs = options.availableCLIs || {};
  const modelValue = await promptForModelConfig(modelKey, existingModels, availableCLIs);

  if (!modelValue) {
    throw new Error('Model configuration cannot be empty.');
  }

  writeModelToConfig(configFile, modelKey, modelValue);
  return modelValue;
}
