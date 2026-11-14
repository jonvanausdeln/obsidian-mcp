/**
 * Markdown helpers for in-place note edits (edit_note, update_section).
 *
 * All functions work on LF-normalized text. Use `toLF` / `restoreEol` around
 * them so notes saved with CRLF line endings keep their original style.
 */

export type Eol = '\n' | '\r\n';

/**
 * Normalize text to LF and report the note's original line ending
 */
export function toLF(text: string): { text: string; eol: Eol } {
  const eol: Eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { text: text.replace(/\r\n/g, '\n'), eol };
}

/**
 * Convert LF text back to the given line ending
 */
export function restoreEol(text: string, eol: Eol): string {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

/**
 * Count non-overlapping occurrences of `needle` in `haystack`
 */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export interface Heading {
  /** 0-based line index of the heading */
  line: number;
  /** 1-6 */
  level: number;
  /** Heading text without the leading #'s, trimmed */
  text: string;
}

/**
 * Find ATX headings (`# Title`), ignoring YAML frontmatter and fenced code blocks
 */
export function findHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  let i = 0;

  // Skip YAML frontmatter at the very top
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, idx) => idx > 0 && (l.trim() === '---' || l.trim() === '...'));
    if (end !== -1) i = end + 1;
  }

  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;

    const m = line.match(/^\s{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/);
    if (m) {
      headings.push({ line: i, level: m[1]!.length, text: m[2]!.trim() });
    }
  }
  return headings;
}

/**
 * Parse a heading selector like "Produce", "## Produce", or "Groceries > Produce".
 * Each part may carry its own #'s to pin the level.
 */
export function parseHeadingSelector(selector: string): Array<{ text: string; level?: number }> {
  return selector
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(#{1,6})\s+(.*)$/);
      return m ? { text: m[2]!.trim(), level: m[1]!.length } : { text: part };
    });
}

export interface SectionRange {
  heading: Heading;
  /** First body line (line after the heading) */
  bodyStart: number;
  /** Exclusive end: next heading of same or higher level, or end of file */
  end: number;
}

/**
 * Compute the section range for a heading: everything until the next heading
 * of the same or higher level (so subsections are included).
 */
export function sectionRange(headings: Heading[], index: number, totalLines: number): SectionRange {
  const heading = headings[index]!;
  const next = headings.slice(index + 1).find((h) => h.level <= heading.level);
  return { heading, bodyStart: heading.line + 1, end: next ? next.line : totalLines };
}

/**
 * Find all headings that match a selector. A multi-part selector
 * ("Parent > Child") requires each part to be nested inside the previous one.
 */
export function matchHeadings(headings: Heading[], totalLines: number, selector: string): number[] {
  const parts = parseHeadingSelector(selector);
  if (parts.length === 0) return [];

  const norm = (s: string) => s.trim().toLowerCase();
  const matchesPart = (h: Heading, part: { text: string; level?: number }) =>
    norm(h.text) === norm(part.text) && (part.level === undefined || h.level === part.level);

  // Candidate scopes: start with the whole document
  let scopes: Array<{ start: number; end: number; minLevel: number }> = [
    { start: 0, end: totalLines, minLevel: 0 },
  ];
  let matched: number[] = [];

  for (const part of parts) {
    matched = [];
    for (const scope of scopes) {
      headings.forEach((h, idx) => {
        if (h.line >= scope.start && h.line < scope.end && h.level > scope.minLevel && matchesPart(h, part)) {
          matched.push(idx);
        }
      });
    }
    scopes = matched.map((idx) => {
      const r = sectionRange(headings, idx, totalLines);
      return { start: r.bodyStart, end: r.end, minLevel: r.heading.level };
    });
  }

  return [...new Set(matched)];
}

/**
 * Trim blank lines from both ends of an array of lines
 */
export function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start++;
  while (end > start && lines[end - 1]!.trim() === '') end--;
  return lines.slice(start, end);
}
