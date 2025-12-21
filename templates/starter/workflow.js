/**
/**
 * __WORKFLOW_NAME__ Workflow
 *
 * Native JavaScript workflow - write normal async/await code!
 *
 * Features:
 * - memory object auto-persists to disk (use memory guards for idempotency)
 * - Use standard JS control flow (if, for, etc.)
 * - Interactive prompts pause and wait for user input
 */

import { agent, memory, askHuman, parallel } from 'agent-state-machine';
import { notify } from './scripts/mac-notification.js';

export default async function() {
  console.log('Starting __WORKFLOW_NAME__ workflow...');

  // Example: Get user input (saved to memory)
  const userLocation = await askHuman('Where do you live?');
  console.log('Example prompt answer:', userLocation);

  const userName = await agent('yoda-name-collector');
  memory.userName = userName;

  // Provide context
  // const userName = await agent('yoda-name-collector', { name: 'Luke' });

  console.log('Example agent memory.userName:', memory.userName || userName);

  // Context is explicit: pass what the agent needs
  const { greeting } = await agent('yoda-greeter', { userLocation, memory });
  console.log('Example agent greeting::', greeting);

  // Or you can provide context manually
  // await agent('yoda-greeter', userName);

  // Example: Parallel execution
  // const [a, b, c] = await parallel([
  //   agent('yoda-greeter', { name: 'the names augustus but friends call me gus' }),
  //   agent('yoda-greeter', { name: 'uriah' }),
  //   agent('yoda-greeter', { name: 'lucas' })
  // ]);

  // console.log('a: ' + JSON.stringify(a))
  // console.log('b: ' + JSON.stringify(b))
  // console.log('c: ' + JSON.stringify(c))

  notify(['__WORKFLOW_NAME__', userName.name || userName + ' has been greeted!']);

  console.log('Workflow completed!');
}
