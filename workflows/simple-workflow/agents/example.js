/**
 * Example Agent for simple-workflow
 * 
 * Agents are async functions that receive context and return updated context.
 * 
 * To use LLM capabilities:
 *   const { llm, llmText, llmJSON } = require('agent-state-machine');
 *   const response = await llm(context, { model: 'smart', prompt: 'Your prompt' });
 */

// Uncomment to use LLM:
// const { llm, llmText } = require('agent-state-machine');

async function handler(context) {
  console.log('[Agent: example] Processing context...');
  
  // Access global steering prompt if available
  if (context._steering?.global) {
    console.log('[Agent: example] Steering prompt loaded (' + context._steering.global.length + ' chars)');
  }
  
  // Example: Call an LLM (uncomment and configure models in workflow.js)
  // const response = await llm(context, {
  //   model: 'smart',  // References models.smart in workflow.js
  //   prompt: 'Say hello and describe what you can help with.'
  // });
  // console.log('[Agent: example] LLM response:', response.text);
  
  return {
    ...context,
    exampleProcessed: true,
    processedAt: new Date().toISOString()
  };
}

module.exports = handler;
module.exports.handler = handler;

// Optional metadata
module.exports.meta = {
  name: 'example',
  description: 'An example agent to get you started',
  version: '1.0.0'
};
