/**
 * Interaction helpers for project-builder template
 *
 * Re-exports core interaction utilities from agent-state-machine
 * and adds an LLM-based interpreter for ambiguous responses.
 */

import {
  agent,
  createInteraction,
  formatInteractionPrompt,
  normalizeInteraction,
  parseInteractionResponse
} from 'agent-state-machine';

// Re-export core utilities
export { createInteraction, formatInteractionPrompt, normalizeInteraction };

/**
 * Parse a response with LLM interpreter fallback
 *
 * Uses the response-interpreter agent when fast-path matching fails.
 */
export async function parseResponse(interaction, rawResponse) {
  return parseInteractionResponse(interaction, rawResponse, async (int, raw) => {
    // Use the response-interpreter agent to interpret ambiguous responses
    const result = await agent('response-interpreter', {
      userResponse: raw,
      interaction: int
    });
    return result;
  });
}
