import matter from 'gray-matter';

/**
 * Tag and frontmatter helpers shared by get_tags and search_notes.
 */

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
  tags: Set<string>;
}

/**
 * Normalize frontmatter `tags` (string, comma/space separated string, or array).
 * Leading "#" is stripped.
 */
export function normalizeFrontmatterTags(tags: unknown): string[] {
  const raw: unknown[] = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(/[,\s]+/) : [];
  return raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
}

/**
 * Extract inline #tags from markdown body text.
 * Skips URL fragments (preceded by a word char or /) and pure numbers (#123).
 */
export function extractInlineTags(body: string): string[] {
  const tags: string[] = [];
  for (const match of body.matchAll(/(?<![\w/])#([\w/-]+)/g)) {
    const tag = match[1];
    if (tag && !/^\d+$/.test(tag)) tags.push(tag);
  }
  return tags;
}

/**
 * Parse a note into frontmatter, body and the combined tag set.
 * Malformed frontmatter is treated as no frontmatter.
 */
export function parseNote(content: string): ParsedNote {
  let frontmatter: Record<string, unknown> = {};
  let body = content;
  try {
    const parsed = matter(content);
    frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
    body = parsed.content;
  } catch {
    // Invalid YAML: fall back to treating the whole file as body
  }
  const tags = new Set<string>([
    ...normalizeFrontmatterTags(frontmatter.tags ?? frontmatter.tag),
    ...extractInlineTags(body),
  ]);
  return { frontmatter, body, tags };
}

/**
 * Obsidian-style tag match: case-insensitive, and a parent tag matches its
 * nested children ("recipe" matches "recipe/dinner").
 */
export function tagMatches(noteTag: string, wanted: string): boolean {
  const a = noteTag.toLowerCase();
  const b = wanted.replace(/^#/, '').toLowerCase();
  return a === b || a.startsWith(b + '/');
}

export function noteHasTags(tags: Set<string>, wanted: string[], mode: 'all' | 'any'): boolean {
  const has = (w: string) => [...tags].some((t) => tagMatches(t, w));
  return mode === 'all' ? wanted.every(has) : wanted.some(has);
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'string' && typeof expected === 'string') {
    return actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  if (actual instanceof Date && typeof expected === 'string') {
    return actual.toISOString().slice(0, 10) === expected;
  }
  return actual === expected;
}

/**
 * Match frontmatter against a filter. Each filter key must match:
 * - scalar: equal (strings case-insensitive); if the note's value is a list, the list must contain it
 * - array: the note's value must contain every listed element
 * - null: the key must be absent
 * Keys are matched case-insensitively.
 */
export function frontmatterMatches(frontmatter: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  const lowerKeys = new Map(Object.keys(frontmatter).map((k) => [k.toLowerCase(), k]));
  return Object.entries(filter).every(([key, expected]) => {
    const realKey = lowerKeys.get(key.toLowerCase());
    const actual = realKey === undefined ? undefined : frontmatter[realKey];
    if (expected === null) return actual === undefined || actual === null;
    if (actual === undefined) return false;

    const actualList = Array.isArray(actual) ? actual : [actual];
    const expectedList = Array.isArray(expected) ? expected : [expected];
    return expectedList.every((e) => actualList.some((a) => valueEquals(a, e)));
  });
}
