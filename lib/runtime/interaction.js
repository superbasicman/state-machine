/**
 * Interaction Schema and Helpers
 *
 * Provides structured interaction types (choice, text, confirm) for human-in-the-loop workflows.
 */

// Default schema for interactions
export const InteractionSchema = {
  type: 'text',
  slug: '',
  prompt: '',
  options: [],
  allowCustom: true,
  multiSelect: false,
  placeholder: '',
  validation: {
    minLength: 0,
    maxLength: 0,
    pattern: ''
  },
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  default: '',
  context: {}
};

// Default schema for interaction responses
export const InteractionResponseSchema = {
  slug: '',
  selectedKey: '',
  selectedKeys: [],
  text: '',
  confirmed: false,
  raw: '',
  interpreted: false,
  isCustom: false,
  customText: ''
};

/**
 * Normalize an interaction object by merging with defaults
 */
export function normalizeInteraction(interaction) {
  if (!interaction || typeof interaction !== 'object') return null;
  return {
    ...InteractionSchema,
    ...interaction,
    validation: {
      ...InteractionSchema.validation,
      ...(interaction.validation || {})
    }
  };
}

/**
 * Validate an interaction object
 */
export function validateInteraction(interaction) {
  const errors = [];
  if (!interaction || typeof interaction !== 'object') {
    return { valid: false, errors: ['Interaction must be an object'] };
  }
  if (!interaction.type) errors.push('Missing type');
  if (!interaction.slug) errors.push('Missing slug');
  if (!interaction.prompt) errors.push('Missing prompt');
  if (interaction.type === 'choice' && (!Array.isArray(interaction.options) || interaction.options.length === 0)) {
    errors.push('Choice interaction must include options');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Normalize an interaction response object
 */
export function normalizeInteractionResponse(response) {
  if (!response || typeof response !== 'object') return null;
  return {
    ...InteractionResponseSchema,
    ...response
  };
}

/**
 * Validate an interaction response
 */
export function validateInteractionResponse(response) {
  const errors = [];
  if (!response || typeof response !== 'object') {
    return { valid: false, errors: ['Response must be an object'] };
  }
  if (!('raw' in response)) errors.push('Missing raw response');
  return { valid: errors.length === 0, errors };
}

/**
 * Create an interaction object with defaults
 */
export function createInteraction(type, slug, options = {}) {
  return normalizeInteraction({
    type,
    slug,
    ...options
  });
}

/**
 * Format an interaction as a human-readable prompt string
 */
export function formatInteractionPrompt(interaction) {
  const prompt = String(interaction?.prompt || interaction?.question || interaction?.content || '').trim();
  const lines = [];

  if (prompt) lines.push(prompt);

  if (interaction?.type === 'choice' && Array.isArray(interaction.options)) {
    lines.push('', 'Options:');
    interaction.options.forEach((opt, index) => {
      const letter = String.fromCharCode(65 + index);
      const label = opt.label || opt.key || `Option ${index + 1}`;
      const desc = opt.description ? ` - ${opt.description}` : '';
      lines.push(`- ${letter}: ${label}${desc}`);
    });
    if (interaction.allowCustom) {
      lines.push('- Other: Provide a custom response');
    }
  }

  if (interaction?.type === 'confirm') {
    const confirmLabel = interaction.confirmLabel || 'Confirm';
    const cancelLabel = interaction.cancelLabel || 'Cancel';
    lines.push('', 'Options:');
    lines.push(`- A: ${confirmLabel}`);
    lines.push(`- B: ${cancelLabel}`);
  }

  return lines.join('\n').trim();
}

/**
 * Match a single-select response against options
 * Returns the matched option key/label, or null if no match
 */
export function matchSingleSelect(options, input) {
  const lower = String(input || '').toLowerCase().trim();

  for (let i = 0; i < options.length; i += 1) {
    const opt = options[i];
    const letter = String.fromCharCode(65 + i).toLowerCase();
    const key = String(opt.key || '').toLowerCase();
    const label = String(opt.label || '').toLowerCase();
    const letterRegex = new RegExp(`^${letter}(\\s|[-:.)\\]])`, 'i');

    if (
      lower === letter ||
      letterRegex.test(lower) ||
      lower === key ||
      lower === label ||
      lower.startsWith(`${label}:`) ||
      lower.startsWith(`${label} -`)
    ) {
      return opt.key || opt.label || letter.toUpperCase();
    }
  }
  return null;
}

/**
 * Match a multi-select response against options
 * Returns array of matched option keys/labels
 */
export function matchMultiSelect(options, input) {
  const lower = String(input || '').toLowerCase().trim();
  const tokens = lower.split(/[,\s]+/).filter(Boolean);
  const selections = new Set();

  // Match letter patterns like "a:", "b)", "c -"
  const letterMatches = lower.matchAll(/(^|[\s,])([a-z])\s*[-:.)\]]/g);
  for (const match of letterMatches) {
    const letter = match[2];
    const index = letter.charCodeAt(0) - 97;
    if (index >= 0 && index < options.length) {
      const opt = options[index];
      selections.add(opt.key || opt.label || letter.toUpperCase());
    }
  }

  // Match tokens against keys/labels
  tokens.forEach((token) => {
    for (let i = 0; i < options.length; i += 1) {
      const opt = options[i];
      const letter = String.fromCharCode(65 + i).toLowerCase();
      const key = String(opt.key || '').toLowerCase();
      const label = String(opt.label || '').toLowerCase();
      if (token === letter || token === key || token === label) {
        selections.add(opt.key || opt.label || letter.toUpperCase());
      }
    }
  });

  return Array.from(selections);
}

/**
 * Parse a raw response string into a structured response object
 *
 * @param {object} interaction - The interaction schema
 * @param {string|object} rawResponse - The raw user response
 * @param {function} [interpreter] - Optional async function to interpret ambiguous responses
 * @returns {object} Structured response object
 */
export async function parseInteractionResponse(interaction, rawResponse, interpreter = null) {
  const normalized = normalizeInteraction(interaction);
  if (!normalized) return { raw: String(rawResponse ?? '') };

  // If already an object, normalize it
  if (rawResponse && typeof rawResponse === 'object') {
    return normalizeInteractionResponse({
      ...rawResponse,
      raw: rawResponse.raw ?? rawResponse.text ?? ''
    });
  }

  const raw = String(rawResponse ?? '').trim();

  // Text type - just return the text
  if (normalized.type === 'text') {
    return { text: raw, raw };
  }

  // Confirm type - check for yes/no patterns
  if (normalized.type === 'confirm') {
    const lower = raw.toLowerCase();
    const confirmLabel = (normalized.confirmLabel || 'confirm').toLowerCase();
    const cancelLabel = (normalized.cancelLabel || 'cancel').toLowerCase();

    const confirmed = lower.startsWith('y') || lower.startsWith('a') ||
                      lower.startsWith('confirm') || lower === confirmLabel;
    const cancelled = lower.startsWith('n') || lower.startsWith('b') ||
                      lower.startsWith('cancel') || lower === cancelLabel;

    if (confirmed || cancelled) {
      return { confirmed, raw };
    }

    // Try interpreter if provided
    if (interpreter) {
      const interpreted = await tryInterpreter(interpreter, normalized, raw);
      if (interpreted) return interpreted;
    }

    // Default to not confirmed for ambiguous responses
    return { confirmed: false, raw };
  }

  // Choice type - match against options
  if (normalized.type === 'choice') {
    const options = normalized.options || [];

    if (normalized.multiSelect) {
      const selectedKeys = matchMultiSelect(options, raw);
      if (selectedKeys.length > 0) {
        return { selectedKeys, raw };
      }
    } else {
      const selectedKey = matchSingleSelect(options, raw);
      if (selectedKey) {
        return { selectedKey, raw };
      }
    }

    // Try interpreter if provided
    if (interpreter) {
      const interpreted = await tryInterpreter(interpreter, normalized, raw);
      if (interpreted) return interpreted;
    }

    // Treat as custom response if allowed
    if (normalized.allowCustom !== false) {
      return { isCustom: true, customText: raw, raw };
    }
  }

  return { raw };
}

/**
 * Helper to safely call the interpreter function
 */
async function tryInterpreter(interpreter, interaction, raw) {
  try {
    const result = await interpreter(interaction, raw);
    if (result && typeof result === 'object') {
      if (result.selectedKey || result.selectedKeys?.length || result.confirmed !== undefined) {
        return { ...result, raw, interpreted: true };
      }
      if (result.isCustom && interaction.allowCustom !== false) {
        return { ...result, raw, interpreted: true };
      }
    }
  } catch (error) {
    // Silently fail - caller can handle uninterpreted responses
  }
  return null;
}
