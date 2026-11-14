/**
 * In-process per-file lock for read-modify-write operations.
 *
 * MCP clients may issue tool calls in parallel (e.g. two edits to the same
 * shopping list). Without serialization both calls read the old content and
 * the second write silently drops the first edit.
 */
import { posix } from 'path';

const tails = new Map<string, Promise<unknown>>();

export async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  // Normalize so "Lists//Shopping.md", "./Lists/Shopping.md" and "lists\shopping.md" share a lock
  const key = posix
    .normalize(path.replace(/\\/g, '/'))
    .replace(/^(\.\/|\/)+/, '')
    .toLowerCase();
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  tails.set(key, run);
  try {
    return await run;
  } finally {
    // Clean up if nothing queued behind us
    if (tails.get(key) === run) tails.delete(key);
  }
}
