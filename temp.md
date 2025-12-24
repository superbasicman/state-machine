Plan: Unknown Model Key Error Handler

 Goal

 When an LLM call fails due to an unknown model key, show an interactive prompt (terminal + remote follow) that lets the user map the key to
  an available model or enter a custom value, then save the mapping to config.js.

 Implementation Steps

 Step 1: Create Config Utilities Module

 New file: /lib/config-utils.js

 Extract config manipulation utilities from cli.js into a shared module:
 - findConfigObjectRange(source) - find start/end of config object
 - readModelFromConfig(configFile, modelKey) - read a model mapping
 - writeModelToConfig(configFile, modelKey, modelValue) - add/update a model mapping

 Pattern based on existing writeRemotePathToConfig() at bin/cli.js:206-260.

 Step 2: Create Model Resolution Module

 New file: /lib/runtime/model-resolution.js

 Create the interaction handler:
 - buildModelSuggestions() - generate options based on detected CLI tools (claude, gemini, codex) + common API formats
 - promptForModelConfig(modelKey, existingModels) - show choice interaction with allowCustom: true
 - resolveUnknownModel(modelKey, config, workflowDir) - orchestrate prompt + save to config

 Uses existing askHuman() with interaction type choice.

 Step 3: Modify llm() to Support Model Resolution

 Modify: /lib/llm.js:424-429

 Instead of throwing immediately, check if runtime context is available:
 if (!modelConfig) {
   const runtime = getCurrentRuntime();
   if (runtime) {
     // Interactive resolution
     modelConfig = await resolveUnknownModel(options.model, config, workflowDir);
     runtime.workflowConfig.models[options.model] = modelConfig;
     context._config.models[options.model] = modelConfig;
   } else {
     // No runtime - throw standard error
     throw new Error(`Unknown model key: "${options.model}"...`);
   }
 }

 Step 4: Add Runtime Getter

 Modify: /lib/runtime/runtime.js

 Add getCurrentRuntime() export that returns the active runtime instance (for use by llm.js).

 Step 5: Update Exports

 Modify: /lib/index.js

 Export new utilities if needed for external use.

 Step 6: Refactor cli.js

 Modify: /bin/cli.js:122-269

 Replace local findConfigObjectRange and related functions with imports from /lib/config-utils.js.

 Files to Modify/Create

 | File                             | Action                                               |
 |----------------------------------|------------------------------------------------------|
 | /lib/config-utils.js             | Create - config file manipulation utilities          |
 | /lib/runtime/model-resolution.js | Create - model resolution interaction handler        |
 | /lib/llm.js                      | Modify - add model resolution logic at lines 424-429 |
 | /lib/runtime/runtime.js          | Modify - add getCurrentRuntime() export              |
 | /lib/index.js                    | Modify - add new exports                             |
 | /bin/cli.js                      | Refactor - use shared config utilities               |

 UI Integration (No Changes Needed)

 The existing ChoiceInteraction component already supports allowCustom: true (lines 89-112):
 - Shows model options as clickable cards
 - "Other" button reveals textarea for custom input
 - Returns { isCustom: true, customText: "..." } or { selectedKey: "..." }

 User Flow

 1. Workflow runs agent with model: 'fast'
 2. llm() detects fast not in config.models
 3. Choice interaction appears:
 Unknown model key: "fast"

 How would you like to configure this model?
 Existing models: low, med, high

 [claude -p] Claude CLI with print mode
 [gemini] Gemini CLI
 [api:openai:gpt-4] OpenAI API
 [Other] Provide a custom response
 4. User selects option or enters custom value
 5. Mapping saved to config.js:
 models: {
   low: "gemini",
   fast: "claude -p",  // <-- added
 }
 6. In-memory config updated, LLM call continues
 7. Next run uses saved mapping without prompting