/**
 * Type definitions for Obsidian MCP Server
 */

/**
 * Error types for categorized error handling
 */
export enum ObsidianErrorType {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INVALID_PATH = 'INVALID_PATH',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  PARSE_ERROR = 'PARSE_ERROR',
  DISK_FULL = 'DISK_FULL',
  IO_ERROR = 'IO_ERROR',
  API_UNAVAILABLE = 'API_UNAVAILABLE',
  API_ERROR = 'API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Structured error with categorization and user-friendly messages
 */
export interface ObsidianError {
  type: ObsidianErrorType;
  message: string;
  details?: {
    path?: string;
    suggestedAction?: string;
    originalError?: unknown;
  };
}

/**
 * File statistics
 */
export interface FileStats {
  size: number;
  created: Date;
  modified: Date;
}

/**
 * File information from listing operations
 */
export interface FileInfo {
  path: string;
  name: string;
  size: number;
  modified: Date;
  isDirectory: boolean;
}

/**
 * Note metadata for list operations
 */
export interface NoteMetadata {
  path: string;
  size: number;
  modified: string;
  created: string;
}

/**
 * Search match result
 */
export interface SearchMatch {
  path: string;
  line: number;
  content: string;
  context?: {
    before: string[];
    after: string[];
  };
}

/**
 * Read note result
 */
export interface ReadNoteResult {
  content: string;
  stats: FileStats;
}

/**
 * Write note result
 */
export interface WriteNoteResult {
  success: boolean;
  path: string;
  created: boolean;
}

/**
 * Append note result
 */
export interface AppendNoteResult {
  success: boolean;
  newLength: number;
}

/**
 * Update section result
 */
export interface UpdateSectionResult {
  success: boolean;
  sectionFound: boolean;
}

/**
 * Delete note result
 */
export interface DeleteNoteResult {
  success: boolean;
  deleted: string;
}

/**
 * List notes result
 */
export interface ListNotesResult {
  notes: NoteMetadata[];
  total: number;
  filtered: number;
}

/**
 * Search notes result
 */
export interface SearchNotesResult {
  results: Array<{
    path: string;
    matches: SearchMatch[];
    matchCount: number;
  }>;
  totalMatches: number;
  searchedFiles: number;
}

/**
 * Vault statistics
 */
export interface VaultStats {
  totalNotes: number;
  totalSize: number;
  folders: number;
  vaultPath: string;
}

/**
 * Frontmatter data (YAML)
 */
export type FrontmatterData = Record<string, unknown>;

/**
 * Parsed note with frontmatter
 */
export interface ParsedNote {
  frontmatter: FrontmatterData | null;
  content: string;
}

/**
 * Tool input parameters
 */
export interface ReadNoteParams {
  path: string;
}

export interface WriteNoteParams {
  path: string;
  content: string;
  createDirs?: boolean;
}

export interface AppendNoteParams {
  path: string;
  content: string;
  separator?: string;
}

export interface UpdateSectionParams {
  path: string;
  heading: string;
  content: string;
  createIfMissing?: boolean;
}

export interface DeleteNoteParams {
  path: string;
  confirm: boolean;
}

export interface ListNotesParams {
  path?: string;
  recursive?: boolean;
  pattern?: string;
}

export interface SearchNotesParams {
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  path?: string;
  maxResults?: number;
}

/**
 * Retry options
 */
export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay?: number;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * REST API Response Types
 */

/**
 * Periodic note info from API
 */
export interface PeriodicNoteInfo {
  path: string;
  exists: boolean;
  date: string;
}

/**
 * Active file info from API
 */
export interface ActiveFileInfo {
  path: string | null;
  cursor?: {
    line: number;
    ch: number;
  };
}

/**
 * Command execution result from API
 */
export interface CommandResult {
  success: boolean;
  result?: unknown;
}

/**
 * Daily note tool parameters
 */
export interface GetDailyNoteParams {
  date?: string; // ISO date string (YYYY-MM-DD), defaults to today
}

export interface AppendToDailyParams {
  content: string;
  date?: string; // ISO date string (YYYY-MM-DD), defaults to today
  separator?: string;
  timestamp?: boolean;
  createIfMissing?: boolean;
}

/**
 * Daily note tool results
 */
export interface GetDailyNoteResult {
  path: string;
  exists: boolean;
  content?: string;
  stats?: FileStats;
  source: 'api' | 'filesystem';
}

export interface AppendToDailyResult {
  success: boolean;
  path: string;
  newLength: number;
  source: 'api' | 'filesystem';
}

/**
 * Frontmatter tool parameters and results (Session 5)
 */
export interface UpdateFrontmatterParams {
  path: string;
  updates: Record<string, unknown>; // Fields to add or update
  remove?: string[]; // Fields to remove
  merge?: boolean; // Merge with existing (default: true)
}

export interface UpdateFrontmatterResult {
  success: boolean;
  path: string;
  frontmatter: FrontmatterData;
  updated: string[]; // Fields that were updated
  removed: string[]; // Fields that were removed
}

/**
 * Tag tool parameters and results (Session 5)
 */
export interface GetTagsParams {
  path?: string; // Specific file or folder to analyze (default: entire vault)
  recursive?: boolean; // Include subdirectories (default: true)
  includeCount?: boolean; // Include usage count for each tag (default: true)
}

export interface TagInfo {
  tag: string;
  count: number;
  files: string[]; // Files containing this tag
}

export interface GetTagsResult {
  tags: TagInfo[];
  totalTags: number;
  totalFiles: number;
}

/**
 * Template tool parameters and results (Session 5)
 */
export interface ApplyTemplateParams {
  path: string; // Target file path
  templatePath: string; // Path to template file
  variables?: Record<string, string>; // Variables to substitute (e.g., {{title}} -> "My Note")
  position?: 'replace' | 'prepend' | 'append'; // Where to insert template (default: replace)
}

export interface ApplyTemplateResult {
  success: boolean;
  path: string;
  templateUsed: string;
  variablesApplied: string[];
}
