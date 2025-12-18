/**
 * File: /lib/runtime/parallel.js
 */

/**
 * Parallel execution module for running multiple agents concurrently
 */

/**
 * Execute multiple agent calls in parallel
 * @param {Promise[]} agentCalls - Array of agent() call promises
 * @returns {Promise<any[]>} Array of results in same order as input
 *
 * @example
 * const [review1, review2] = await parallel([
 *   agent('code-review', { file: 'src/a.js' }),
 *   agent('code-review', { file: 'src/b.js' })
 * ]);
 */
export async function parallel(agentCalls) {
  if (!Array.isArray(agentCalls)) {
    throw new Error('parallel() expects an array of promises');
  }

  if (agentCalls.length === 0) {
    return [];
  }

  // Promise.all maintains order
  return Promise.all(agentCalls);
}

/**
 * Execute agent calls in parallel with a concurrency limit
 * @param {Promise[]} agentCalls - Array of agent() call promises
 * @param {number} limit - Maximum concurrent executions
 * @returns {Promise<any[]>} Array of results in same order as input
 */
export async function parallelLimit(agentCalls, limit = 3) {
  if (!Array.isArray(agentCalls)) {
    throw new Error('parallelLimit() expects an array of promises');
  }

  if (agentCalls.length === 0) {
    return [];
  }

  const results = new Array(agentCalls.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < agentCalls.length) {
      const index = currentIndex++;
      results[index] = await agentCalls[index];
    }
  }

  // Start up to 'limit' workers
  const workers = [];
  for (let i = 0; i < Math.min(limit, agentCalls.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}
