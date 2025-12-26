/**
 * File: /lib/runtime/prompt.js
 */

/**
 * Initial prompt module for user input collection
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { getCurrentRuntime } from './runtime.js';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  dim: '\x1b[2m'
};

/**
 * Request user input with memory-based resume support
 * @param {string} question - Question to ask the user
 * @param {object} options - Options
 * @param {string} options.slug - Unique identifier for this prompt (for file)
 * @returns {Promise<string>} User's response
 */
export async function askHuman(question, options = {}) {
  const runtime = getCurrentRuntime();
  if (!runtime) {
    throw new Error('askHuman() must be called within a workflow context');
  }

  const slug = options.slug || generateSlug(question);
  const memoryKey = `_interaction_${slug}`;
  const interaction = options.interaction || null;
  const prompt = interaction?.prompt || question;

  await runtime.prependHistory({
    event: 'PROMPT_REQUESTED',
    slug,
    targetKey: memoryKey,
    type: interaction?.type || 'text',
    prompt,
    options: interaction?.options,
    allowCustom: interaction?.allowCustom,
    multiSelect: interaction?.multiSelect,
    placeholder: interaction?.placeholder,
    validation: interaction?.validation,
    confirmLabel: interaction?.confirmLabel,
    cancelLabel: interaction?.cancelLabel,
    context: interaction?.context,
    // Include full-auto info for remote UI countdown
    fullAuto: runtime.workflowConfig.fullAuto || false,
    autoSelectDelay: runtime.workflowConfig.autoSelectDelay ?? 20
  });

  // Full-auto mode: show countdown and auto-select first option for choice interactions
  if (runtime.workflowConfig.fullAuto && interaction?.type === 'choice') {
    const options = interaction.options || [];
    if (options.length > 0) {
      const firstOption = options[0];
      const autoResponse = firstOption.key || firstOption.label;
      const delay = runtime.workflowConfig.autoSelectDelay ?? 20;

      console.log(`\n${C.cyan}${C.bold}${interaction.prompt || 'Choice required'}${C.reset}`);
      if (runtime.remoteEnabled && runtime.remoteUrl) {
        console.log(`${C.dim}(Remote: ${runtime.remoteUrl})${C.reset}`);
      }

      // Countdown timer
      for (let i = delay; i > 0; i--) {
        process.stdout.write(`\r${C.yellow}⚡ Agent deciding for you in ${i}...${C.reset}  `);
        await new Promise(r => setTimeout(r, 1000));
      }
      console.log(`\r${C.green}${C.bold}⚡ Auto-selected: ${autoResponse}${C.reset}          \n`);

      runtime._rawMemory[memoryKey] = autoResponse;
      runtime.persist();

      await runtime.prependHistory({
        event: 'PROMPT_AUTO_ANSWERED',
        slug,
        autoSelected: autoResponse
      });

      return autoResponse;
    }
  }

  // Check if we're in TTY mode (interactive terminal)
  if (process.stdin.isTTY && process.stdout.isTTY) {
    // Interactive mode - prompt directly, with remote support
    const answer = await askQuestionWithRemote(runtime, question, slug, memoryKey, interaction);
    console.log('');

    const normalizedAnswer = normalizePromptAnswer(answer);

    // Save the response to memory
    runtime._rawMemory[memoryKey] = normalizedAnswer;
    runtime.persist();

    await runtime.prependHistory({
      event: 'PROMPT_ANSWERED',
      slug,
      answer: normalizedAnswer.substring(0, 100) + (normalizedAnswer.length > 100 ? '...' : '')
    });

    return normalizedAnswer;
  }

  // Non-TTY mode - create interaction file and wait inline
  const interactionFile = path.join(runtime.interactionsDir, `${slug}.md`);

  const fileContent = `<!-- Note: Edit this file directly and press 'y' in the terminal when finished. Safe to clear this file. -->
# ${slug}

${question}
`;

  fs.writeFileSync(interactionFile, fileContent);

  await runtime.prependHistory({
    event: 'INTERACTION_REQUESTED',
    slug,
    targetKey: memoryKey,
    file: interactionFile,
    question
  });

  // Block and wait for user input (instead of throwing)
  const answer = await runtime.waitForInteraction(interactionFile, slug, memoryKey);

  const normalizedAnswer = normalizePromptAnswer(answer);

  runtime._rawMemory[memoryKey] = normalizedAnswer;
  runtime.persist();

  await runtime.prependHistory({
    event: 'PROMPT_ANSWERED',
    slug,
    answer: normalizedAnswer.substring(0, 100) + (normalizedAnswer.length > 100 ? '...' : '')
  });

  return normalizedAnswer;
}

/**
 * Interactive terminal question with remote support
 * Allows both local TTY input and remote browser responses
 */
function askQuestionWithRemote(runtime, question, slug, memoryKey, interaction = null) {
  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      resolved = true;
      runtime.pendingRemoteInteraction = null;
    };

    // Set up remote interaction listener if remote is enabled
    if (runtime.remoteEnabled) {
      runtime.pendingRemoteInteraction = {
        slug,
        targetKey: memoryKey,
        resolve: (response) => {
          if (resolved) return;
          cleanup();
          rl.close();
          console.log(`\n${C.green}✓ Answered via remote${C.reset}`);
          resolve(response);
        },
        reject: () => { } // Prompts don't reject
      };
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Show remote URL if available
    let promptText = `\n${C.cyan}${C.bold}${question}${C.reset}`;
    
    // Show placeholder if provided
    if (interaction?.placeholder) {
      promptText += `\n${C.dim}(e.g., ${interaction.placeholder})${C.reset}`;
    }
    
    // Show validation hints if provided
    if (interaction?.validation) {
      const hints = [];
      if (interaction.validation.minLength) {
        hints.push(`min ${interaction.validation.minLength} chars`);
      }
      if (interaction.validation.maxLength) {
        hints.push(`max ${interaction.validation.maxLength} chars`);
      }
      if (hints.length > 0) {
        promptText += `\n${C.dim}[${hints.join(', ')}]${C.reset}`;
      }
    }
    
    if (runtime.remoteEnabled && runtime.remoteUrl) {
      promptText += `\n${C.dim}(Remote: ${runtime.remoteUrl})${C.reset}`;
    }
    promptText += `\n${C.yellow}> ${C.reset}`;

    rl.question(promptText, (answer) => {
      if (resolved) return;
      cleanup();
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Interactive terminal question (simple, no remote support)
 */
function askQuestion(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Colorize the question and the input marker
    rl.question(`\n${C.cyan}${C.bold}${question}${C.reset}\n${C.yellow}> ${C.reset}`, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Generate a slug from question text
 */
function generateSlug(question) {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 30);
}

function normalizePromptAnswer(answer) {
  if (typeof answer === 'string') return answer;
  if (answer && typeof answer === 'object') {
    if (typeof answer.raw === 'string') return answer.raw;
    if (typeof answer.text === 'string') return answer.text;
    if (typeof answer.selectedKey === 'string') return answer.selectedKey;
    if (Array.isArray(answer.selectedKeys)) return answer.selectedKeys.join(', ');
    if (typeof answer.confirmed === 'boolean') return answer.confirmed ? 'confirm' : 'cancel';
  }
  return String(answer ?? '');
}
