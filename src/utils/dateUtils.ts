/**
 * Date utility functions for daily note management
 */

/**
 * Format a date as YYYY-MM-DD (ISO format)
 */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse an ISO date string (YYYY-MM-DD) to Date
 */
export function parseDateISO(dateStr: string): Date {
  const date = new Date(dateStr + 'T00:00:00');
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
  }
  return date;
}

/**
 * Get today's date as ISO string (YYYY-MM-DD)
 */
export function getTodayISO(): string {
  return formatDateISO(new Date());
}

/**
 * Format a date for display (e.g., "Monday, November 1, 2025")
 */
export function formatDateLong(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Get current time as formatted string (e.g., "2:30 PM")
 */
export function getCurrentTime(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Common daily note filename patterns
 */
export const DAILY_NOTE_PATTERNS = {
  /** YYYY-MM-DD.md (default) */
  ISO: (date: Date) => `${formatDateISO(date)}.md`,

  /** YYYY-MM-DD_dddd.md (with day name) */
  ISO_WITH_DAY: (date: Date) => {
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    return `${formatDateISO(date)}_${dayName}.md`;
  },

  /** YYYYMMDD.md (compact) */
  COMPACT: (date: Date) => {
    return formatDateISO(date).replace(/-/g, '') + '.md';
  },
};

/**
 * Get default daily note path for a date
 * Default format: Daily Notes/YYYY-MM-DD.md
 */
export function getDailyNotePath(date: Date, folder = 'Daily Notes'): string {
  const filename = DAILY_NOTE_PATTERNS.ISO(date);
  return folder ? `${folder}/${filename}` : filename;
}

/**
 * Validate and normalize a date parameter
 * Accepts ISO date string or defaults to today
 */
export function normalizeDateParam(dateParam?: string): string {
  if (!dateParam) {
    return getTodayISO();
  }

  // Validate format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    throw new Error(`Invalid date format: ${dateParam}. Expected YYYY-MM-DD`);
  }

  // Validate it parses correctly
  parseDateISO(dateParam);

  return dateParam;
}
