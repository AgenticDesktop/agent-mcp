/**
 * Per-file mutation queue: serializes write/edit operations on the same
 * absolute path so concurrent tool calls cannot interleave writes
 * (mirrors pi's file-mutation-queue.ts).
 */

const chains = new Map(); // resolvedPath -> Promise of the last queued op

/**
 * Run fn() after all previously queued operations for filePath settle.
 * @param {string} filePath resolved absolute path
 * @param {() => Promise<any>} fn
 */
export function withFileMutationQueue(filePath, fn) {
	const previous = chains.get(filePath) ?? Promise.resolve();
	const run = previous.catch(() => {}).then(fn);
	// Keep the chain alive regardless of this op's outcome; clean up when idle.
	const tail = run.catch(() => {});
	chains.set(filePath, tail);
	tail.finally(() => {
		if (chains.get(filePath) === tail) chains.delete(filePath);
	});
	return run;
}
