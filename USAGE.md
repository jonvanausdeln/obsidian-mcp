# Obsidian MCP Server - Usage Guide

Complete guide for setting up and using the Obsidian MCP server with different MCP clients.

---

## Table of Contents

1. [Installation](#installation)
2. [Configuration](#configuration)
   - [Enable Hybrid Mode (Recommended)](#3-enable-hybrid-mode-optional-but-recommended)
3. [Setup for Claude Desktop](#setup-for-claude-desktop)
4. [Setup for Claude Code](#setup-for-claude-code)
5. [Testing Your Setup](#testing-your-setup)
6. [Available Tools](#available-tools)
7. [Usage Examples](#usage-examples)
8. [Troubleshooting](#troubleshooting)

---

## Installation

### Prerequisites

- **Node.js**: Version 18.0.0 or higher
- **Obsidian Vault**: An existing Obsidian vault
- **MCP Client**: Claude Desktop or Claude Code (or any MCP-compatible client)

### Install the Server

#### Option 1: From Source (Development)

```bash
# Clone the repository
git clone <repository-url>
cd obsidian-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

#### Option 2: NPX (Once Published)

```bash
# Run directly with npx (future)
npx obsidian-mcp
```

---

## Configuration

### 1. Create Environment File

Create a `.env` file in the project root:

```env
# Required: Path to your Obsidian vault
OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault

# Optional: Hybrid Mode - Obsidian REST API Integration
# Enables enhanced features: daily notes detection, plugin integration, templates
# Server will gracefully fall back to filesystem if API is unavailable
# OBSIDIAN_API_URL=http://127.0.0.1:27123
# OBSIDIAN_API_KEY=your-api-key-here
# OBSIDIAN_VERIFY_SSL=false

# Optional: Logging configuration
LOG_LEVEL=info              # Options: debug, info, warn, error

# Optional: File operation limits
MAX_FILE_SIZE_MB=10         # Maximum file size to read (MB)
ENABLE_DELETE=true          # Allow delete operations

# Optional: Retry configuration
RETRY_MAX_ATTEMPTS=3        # Number of retry attempts
RETRY_BASE_DELAY=100        # Base delay in milliseconds
```

### 2. Verify Vault Path

Ensure your vault path:
- Is an **absolute path** (not relative)
- Points to an **existing directory**
- Contains a `.obsidian` folder (validates it's a real Obsidian vault)

**Examples:**

```env
# ✅ Good - Absolute paths
OBSIDIAN_VAULT_PATH=/Users/username/Documents/MyVault
OBSIDIAN_VAULT_PATH=C:\Users\username\Documents\MyVault

# ❌ Bad - Relative paths
OBSIDIAN_VAULT_PATH=./MyVault
OBSIDIAN_VAULT_PATH=~/Documents/MyVault
```

### 3. Enable Hybrid Mode (Optional but Recommended)

Hybrid mode combines the reliability of filesystem access with advanced features from the Obsidian REST API.

**Benefits:**
- ✅ Automatic daily note path detection (respects your Obsidian settings)
- ✅ Plugin integration (Tasks plugin, Templater, Periodic Notes)
- ✅ Template insertion via Obsidian commands
- ✅ Active file detection
- ✅ Graceful fallback to filesystem when Obsidian isn't running

#### Step 1: Install Obsidian Local REST API Plugin

1. Open Obsidian
2. Go to **Settings → Community Plugins**
3. Click **Browse** and search for **"Local REST API"**
4. Install **"Obsidian Local REST API"** by coddingtonbear
5. Enable the plugin

#### Step 2: Configure the Plugin

1. In Obsidian, go to **Settings → Local REST API**
2. Enable the plugin if not already enabled
3. Note the **Server Port** (default: `27123`)
4. Click **"Generate API Key"** or use existing key
5. Copy the API key

#### Step 3: Update Your `.env` File

Add the API configuration to your `.env` file:

```env
# Required: Path to your Obsidian vault
OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault

# Hybrid Mode - Obsidian REST API Integration
OBSIDIAN_API_URL=http://127.0.0.1:27123
OBSIDIAN_API_KEY=your-actual-api-key-from-step-2
OBSIDIAN_VERIFY_SSL=false

# Optional: Other settings...
LOG_LEVEL=info
```

**Important:**
- Replace `your-actual-api-key-from-step-2` with the key from the plugin settings
- The default port is `27123` unless you changed it in plugin settings
- Use `http://` not `https://` for localhost
- Set `OBSIDIAN_VERIFY_SSL=false` for self-signed certificates

#### Step 4: Verify Hybrid Mode is Working

After restarting your MCP server, check the logs for:

```
[info]: Starting Obsidian MCP Server {
  mode: 'hybrid',
  apiConfigured: true,
  ...
}
[info]: Client initialized { mode: 'hybrid' }
[info]: REST API is available
```

If you see `mode: 'filesystem'`, the API connection failed and it's running in fallback mode.

#### Troubleshooting Hybrid Mode

**API Not Available:**
1. Ensure Obsidian is running
2. Verify the REST API plugin is enabled
3. Check the API URL and port (default: http://127.0.0.1:27123)
4. Test the API manually:
   ```bash
   curl -H "Authorization: Bearer your-api-key" http://127.0.0.1:27123/
   ```

**Works Offline:**
Even without the API, the server works perfectly in filesystem-only mode. You'll miss some advanced features but all basic operations work fine.

---

## Setup for Claude Desktop

Claude Desktop is a standalone application that supports MCP servers.

### 1. Locate Configuration File

The Claude Desktop configuration file location varies by OS:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### 2. Edit Configuration

Add the Obsidian MCP server to your configuration:

#### Option A: Filesystem-Only Mode (Basic)

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": [
        "/absolute/path/to/obsidian-mcp/dist/server.js"
      ],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

#### Option B: Hybrid Mode (Recommended)

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": [
        "/absolute/path/to/obsidian-mcp/dist/server.js"
      ],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault",
        "OBSIDIAN_API_URL": "http://127.0.0.1:27123",
        "OBSIDIAN_API_KEY": "your-api-key-here",
        "OBSIDIAN_VERIFY_SSL": "false",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

**Important Notes:**
- Replace `/absolute/path/to/obsidian-mcp` with the actual path to this project
- Replace `/absolute/path/to/your/vault` with your Obsidian vault path
- Use forward slashes `/` even on Windows, or escape backslashes `\\`
- Ensure the `dist/server.js` file exists (run `npm run build` first)

### 3. Alternative: Using NPX (Once Published)

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": [
        "obsidian-mcp"
      ],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault"
      }
    }
  }
}
```

### 4. Restart Claude Desktop

After editing the configuration:
1. **Save** the `claude_desktop_config.json` file
2. **Quit** Claude Desktop completely
3. **Restart** Claude Desktop

### 5. Verify Connection

In Claude Desktop:
1. Look for a **hammer icon** (🔨) or "MCP" indicator
2. The Obsidian tools should appear in the tools list
3. Try asking: "List the notes in my Obsidian vault"

---

## Setup for Claude Code

Claude Code is a VS Code extension and CLI that supports MCP servers.

### Method 1: Environment Variables (Recommended)

#### 1. Create/Edit `.env` File

In your project root (or wherever you run Claude Code from):

```env
OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault
LOG_LEVEL=info
```

#### 2. Run Claude Code

Claude Code will automatically read from `.env` in the current directory:

```bash
# Navigate to the obsidian-mcp directory
cd /path/to/obsidian-mcp

# Start Claude Code
claude-code
```

### Method 2: Claude Code Configuration

#### 1. Create Claude Code Config

Create or edit `~/.config/claude-code/config.json`:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": [
        "/absolute/path/to/obsidian-mcp/dist/server.js"
      ],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

#### 2. Start Claude Code

```bash
# Start Claude Code CLI
claude-code

# Or use VS Code extension
# The extension will read the config automatically
```

### Method 3: Inline Configuration

For development/testing, you can specify environment variables inline:

```bash
OBSIDIAN_VAULT_PATH=/path/to/vault LOG_LEVEL=debug npm run dev
```

---

## Testing Your Setup

### Quick Test Checklist

1. **Verify Configuration**
   ```bash
   # Check if vault path is accessible
   ls "$OBSIDIAN_VAULT_PATH"

   # Should see .obsidian folder and your notes
   ```

2. **Test the Server Directly**
   ```bash
   # Run in development mode
   npm run dev

   # You should see:
   # - "Logger initialized"
   # - "Configuration loaded"
   # - No errors about vault path
   ```

3. **Test Type Checking**
   ```bash
   npm run typecheck

   # Should complete with no errors
   ```

4. **Run Tests**
   ```bash
   npm test

   # All 241+ tests should pass
   ```

### Verify in Claude Desktop

Ask Claude to:

1. **List notes**: "What notes are in my Obsidian vault?"
2. **Read a note**: "Read the contents of [note-name].md"
3. **Search notes**: "Search my notes for content about [topic]"

### Verify in Claude Code

In a Claude Code session:

```
You: Can you access my Obsidian vault?

Claude: Yes! I can see your Obsidian vault at [path].
Let me list the available tools...

You: List all markdown files in my vault

Claude: [Uses list_notes tool to show files]
```

---

## Available Tools

### 14 Tools Available

#### Note Operations

**`read_note`** - Read a note's content
```typescript
{ path: "Daily/2025-01-15.md" }
```

**`write_note`** - Create or overwrite a note
```typescript
{ path: "Projects/NewNote.md", content: "# My New Note\n\nContent here...", createDirs: true }
```

**`append_note`** - Append content to existing note
```typescript
{ path: "Daily/2025-01-15.md", content: "\n## New Section\n\nAdditional content...", separator: "\n\n" }
```

**`edit_note`** - Exact find-and-replace inside a note (all edits succeed or none are written)
```typescript
{ path: "Lists/Shopping.md", edits: [{ oldText: "- [ ] eggs", newText: "- [x] eggs" }] }
```
Each `oldText` must match exactly once unless `replaceAll: true`. Works on CRLF notes and keeps their line endings.

**`update_section`** - Replace, append, or prepend content under a heading
```typescript
{ path: "Lists/Shopping.md", heading: "Produce", content: "- pears", mode: "append" }
{ path: "Daily/2026-11-14.md", heading: "Tasks > Done", content: "- shipped v0.2", mode: "append", createIfMissing: true }
```
By default only the content directly under the heading is touched (sub-headings are kept); set `includeSubsections: true` to cover the whole section. Headings in code blocks and frontmatter are ignored. Use `## Heading`, `Parent > Child`, or `occurrence` to disambiguate.

**`update_frontmatter`** - Add, update, or remove YAML frontmatter fields
```typescript
{ path: "note.md", updates: { tags: ["ai", "mcp"], status: "complete" }, remove: ["draft"], merge: true }
```

**`apply_template`** - Apply template with variable substitution
```typescript
{ path: "new-note.md", templatePath: "templates/project.md", variables: { title: "My Project" }, position: "replace" }
```

Built-in variables: `{{date}}`, `{{time}}`, `{{date-long}}`

#### Search & Discovery (3 tools)

**`list_notes`** - List notes in vault
```typescript
{ folder: "Daily/", recursive: true, pattern: "2025-*.md", sortBy: "modified", order: "desc", limit: 50 }
```

**`search_notes`** - Full-text search note content
```typescript
{ query: "project ideas", caseSensitive: false, useRegex: false, folder: "Projects/", contextLines: 2, limit: 50 }
```

**`get_tags`** - Extract and analyze tags from vault
```typescript
{ path: "projects", recursive: true, includeCount: true }
```

Returns all tags (frontmatter + inline #tags) with usage counts and file locations.

#### Daily Notes (2 tools) - Hybrid Mode

These use the REST API when available, falling back to filesystem:

**`get_daily_note`** - Get or locate daily note
```typescript
{ date: "2025-11-01" }  // Optional, defaults to today
// Returns: { path, exists, content?, stats?, source: 'api' | 'filesystem' }
```

**`append_to_daily`** - Append content to daily note
```typescript
{ content: "- [ ] Review pull requests", timestamp: true, createIfMissing: true }
```

API mode benefits: auto-detects daily note settings, Tasks plugin integration, triggers Obsidian sync.

---

## Usage Examples

### Example 1: Daily Note Management (Claude Desktop) - NEW ⭐

**User**: "Add a task to today's daily note: Review pull requests"

**Claude** (using hybrid mode):
1. Calls `append_to_daily` with:
   ```typescript
   {
     content: "- [ ] Review pull requests",
     timestamp: true,
     createIfMissing: true
   }
   ```
2. Result: Appends to today's note with timestamp (e.g., "2:30 PM - [ ] Review pull requests")
3. If using API mode, Tasks plugin immediately sees the new task!

**User**: "What's in my daily note for November 1st?"

**Claude**:
1. Calls `get_daily_note` with:
   ```typescript
   {
     date: "2025-11-01"
   }
   ```
2. Returns the note path, content, and whether it exists
3. In API mode, automatically finds your configured daily note location

### Example 2: Knowledge Search (Claude Code)

**Developer**: "Find all notes mentioning 'API integration' and summarize them"

**Claude Code**:
1. Calls `search_notes`:
   ```typescript
   { query: "API integration", maxResults: 20 }
   ```
2. Calls `read_note` for each match
3. Summarizes findings

### Example 3: Note Organization

**User**: "Move all completed tasks from my daily notes to a completed tasks archive"

**Claude**:
1. Calls `list_notes` with `folder: "Daily/"`
2. For each daily note:
   - Calls `read_note`
   - Extracts completed tasks (- [x] items)
   - Calls `append_note` on `Archive/Completed.md`

### Example 4: Research Assistant (Claude Code)

**Developer**: "Help me organize my research notes about React hooks"

**Claude Code**:
1. Calls `search_notes` with `query: "React hooks"`
2. Reads matching notes
3. Suggests organization structure
4. Creates new organized notes using `write_note`

---

## Troubleshooting

### Common Issues

#### Issue 1: "Vault path does not exist"

**Error**: `Configuration validation failed: Vault path does not exist`

**Solutions**:
1. Check the path is absolute (not relative)
2. Verify the directory exists:
   ```bash
   ls "$OBSIDIAN_VAULT_PATH"
   ```
3. Check for typos in the path
4. On Windows, use forward slashes: `C:/Users/...` or escape backslashes: `C:\\Users\\...`

#### Issue 2: "Logger not initialized"

**Error**: `Logger not initialized. Call initializeLogger() first.`

**Solution**: This is an internal error. Make sure you're running the built server:
```bash
npm run build
node dist/server.js
```

#### Issue 3: Server Not Appearing in Claude Desktop

**Solutions**:
1. Verify `claude_desktop_config.json` syntax is valid JSON
2. Check the path to `dist/server.js` is correct
3. Ensure `npm run build` completed successfully
4. Restart Claude Desktop completely (quit, don't just close window)
5. Check Claude Desktop logs:
   - macOS: `~/Library/Logs/Claude/`
   - Windows: `%APPDATA%\Claude\logs\`

#### Issue 4: "Permission denied" Errors

**Error**: `[PERMISSION_DENIED] Permission denied: /path/to/note.md`

**Solutions**:
1. Check file permissions:
   ```bash
   ls -la "$OBSIDIAN_VAULT_PATH"
   ```
2. Ensure the vault directory is readable/writable
3. On Windows, run as administrator if needed
4. Check antivirus isn't blocking access

#### Issue 5: ".obsidian folder not found" Warning

**Warning**: `Warning: .obsidian folder not found in vault path`

**Explanation**: Not critical, but indicates the path might not be a valid Obsidian vault.

**Solution**:
1. Verify you're pointing to the vault root (where `.obsidian` folder exists)
2. If it's a new vault, open it once in Obsidian to create `.obsidian` folder

### Debug Mode

Enable detailed logging to troubleshoot issues:

```env
LOG_LEVEL=debug
```

Then check the output for detailed operation logs.

### Testing Individual Components

```bash
# Test configuration
node -e "require('./dist/utils/config.js').getConfig()"

# Run test suite
npm test

# Test with coverage
npm run test:coverage
```

---

## Advanced Configuration

### Multiple Vaults

To work with multiple vaults, create separate MCP server instances:

```json
{
  "mcpServers": {
    "obsidian-personal": {
      "command": "node",
      "args": ["/path/to/obsidian-mcp/dist/server.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/personal-vault"
      }
    },
    "obsidian-work": {
      "command": "node",
      "args": ["/path/to/obsidian-mcp/dist/server.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/work-vault"
      }
    }
  }
}
```

### Custom File Size Limits

For vaults with large files:

```env
MAX_FILE_SIZE_MB=50  # Allow up to 50MB files
```

### Disable Delete Operations

For safety in production:

```env
ENABLE_DELETE=false  # Prevent any delete operations
```

### Custom Retry Configuration

For slow filesystems or network storage:

```env
RETRY_MAX_ATTEMPTS=5
RETRY_BASE_DELAY=200
```

---

## Security Considerations

### File Access

- The server has **full read/write access** to your vault
- Always review what Claude is doing with your notes
- Consider using `ENABLE_DELETE=false` to prevent accidental deletion
- Keep backups of important vaults

### Path Traversal Protection

The server automatically:
- Blocks paths containing `..` (parent directory traversal)
- Rejects absolute paths (must be relative to vault root)
- Validates all paths before operations

### API Keys (Phase 2)

When using REST API mode:
- Keep `OBSIDIAN_API_KEY` secret
- Don't commit `.env` files to version control
- Use different keys for different environments

---

## Performance Tips

### Large Vaults

For vaults with 1000+ notes:

1. **Use specific paths** in searches:
   ```typescript
   search_notes({ query: "term", path: "Projects/" })
   ```

2. **Limit results**:
   ```typescript
   search_notes({ query: "term", maxResults: 20 })
   ```

3. **Consider increasing file size limit** only if needed

### Concurrent Operations

The server handles concurrent requests safely, but for best performance:
- Batch related operations together
- Let Claude complete one operation before starting another complex task

---

## Getting Help

### Resources

- **Documentation**: See [README.md](README.md) for project overview
- **Architecture**: See [CLAUDE.md](CLAUDE.md) for architecture reference
- **Roadmap**: See [.claude/ROADMAP.md](.claude/ROADMAP.md) for planned features

### Reporting Issues

When reporting issues, include:
1. Your configuration (redact sensitive paths)
2. Log output with `LOG_LEVEL=debug`
3. Steps to reproduce
4. Expected vs actual behavior

---

## Next Steps

Once you have the server running:

1. **Explore your vault**: Ask Claude to summarize your notes
2. **Organize content**: Have Claude help restructure notes
3. **Search and analyze**: Find patterns across your knowledge base
4. **Automate workflows**: Create daily notes, archive completed tasks, etc.

---

*Last updated: 2026-02-28*
*Status: 14 Tools Operational, Hybrid Mode Active*
