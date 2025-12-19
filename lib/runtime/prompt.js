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

/**
 * Request user input with memory-based resume support
 * @param {string} question - Question to ask the user
 * @param {object} options - Options
 * @param {string} options.slug - Unique identifier for this prompt (for file)
 * @returns {Promise<string>} User's response
 */
export async function initialPrompt(question, options = {}) {
  const runtime = getCurrentRuntime();
  if (!runtime) {
    throw new Error('initialPrompt() must be called within a workflow context');
  }

  const slug = options.slug || generateSlug(question);
  const memoryKey = `_interaction_${slug}`;

  runtime.prependHistory({
    event: 'PROMPT_REQUESTED',
    slug,
    question
  });

  // Check if we're in TTY mode (interactive terminal)
  if (process.stdin.isTTY && process.stdout.isTTY) {
    // Interactive mode - prompt directly
    console.log('');
    const answer = await askQuestion(question);
    console.log('');

    // Save the response to memory
    runtime._rawMemory[memoryKey] = answer;
    runtime.persist();

    runtime.prependHistory({
      event: 'PROMPT_ANSWERED',
      slug,
      answer: answer.substring(0, 100) + (answer.length > 100 ? '...' : '')
    });

    return answer;
  }

  // Non-TTY mode - create interaction file and wait inline
  const interactionFile = path.join(runtime.interactionsDir, `${slug}.md`);

  const fileContent = `<!-- Note: Edit this file directly and press 'y' in the terminal when finished. Safe to clear this file. -->
# ${slug}

${question}
`;

  fs.writeFileSync(interactionFile, fileContent);

  runtime.prependHistory({
    event: 'INTERACTION_REQUESTED',
    slug,
    targetKey: memoryKey,
    file: interactionFile,
    question
  });

  // Block and wait for user input (instead of throwing)
  const answer = await runtime.waitForInteraction(interactionFile, slug, memoryKey);

  runtime._rawMemory[memoryKey] = answer;
  runtime.persist();

  runtime.prependHistory({
    event: 'PROMPT_ANSWERED',
    slug,
    answer: answer.substring(0, 100) + (answer.length > 100 ? '...' : '')
  });

  return answer;
}

/**
 * Interactive terminal question
 */
function askQuestion(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`${question}\n> `, (answer) => {
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
