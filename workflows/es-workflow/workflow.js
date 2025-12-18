import { agent, memory, initialPrompt, parallel } from 'agent-state-machine';
import { notify } from './scripts/hello.js';

// Model configuration (also supports models in a separate config export)
export const config = {
  models: {
    codex: "codex --model gpt-5.1-codex-mini",
    fast: "claude -p",
    smart: "claude -m claude-sonnet-4-20250514 -p",
    genius: "claude -m claude-opus-4-20250514 -p",
  }
};

export default async function() {
  console.log('Starting es-workflow workflow...');

  const userInfo = await agent('yoda-collector', { testProp: 'this is a test prop' });
  memory.userInfo = userInfo;
  console.log('Example agent memory.userInfo:', userInfo);

  await agent('yoda-greeter', userInfo);

  notify(['es-workflow', 'completed!']);

  console.log('Workflow completed!');
}
