/**
 * Example Agent for __WORKFLOW_NAME__
 *
 * Agents are async functions that receive a context object and return a result.
 * - Context includes: params, _steering, _config
 */

import { llm } from 'agent-state-machine';

export default async function handler(context) {
  console.log('[Agent: example] Processing...');

  // Access global steering prompt if available
  if (context._steering?.global) {
    console.log('[Agent: example] Steering loaded (' + context._steering.global.length + ' chars)');
  }

  // Example: Call an LLM (configure models in config.js)
  // const response = await llm(context, {
  //   model: 'smart',
  //   prompt: 'Say hello and describe what you can help with.'
  // });
  // console.log('[Agent: example] LLM response:', response.text);

  return {
    ok: true,
    received: Object.keys(context).filter((k) => !String(k).startsWith('_')),
    processedAt: new Date().toISOString()
  };
}

export const meta = {
  name: 'example',
  description: 'An example agent to get you started',
  version: '1.0.0'
};
