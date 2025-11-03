# Obsidian MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that enables AI assistants like Claude to interact with your [Obsidian.md](https://obsidian.md) vault. Read, write, search, and manage your markdown notes through a simple, reliable interface.

## Features

- 🗂️ **Read & Write Notes** - Create, read, update, and append to markdown files
- 🔍 **Search & Filter** - Full-text search with regex support, list notes by folder/pattern
- 📅 **Daily Notes** - Quick access to daily notes with automatic path detection
- 🔄 **Hybrid Mode** - Works offline via filesystem, or online with Obsidian REST API for enhanced features
- 🛡️ **Safe & Secure** - Path validation, file size limits, overwrite protection
- ⚡ **Fast & Reliable** - Direct filesystem access with automatic retry logic

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/obsidian-mcp.git
cd obsidian-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### Configuration for development and testing

Create a `.env` file in the project root:

```env
# Required: Path to your Obsidian vault
OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault

# Optional: Enable REST API integration (recommended)
OBSIDIAN_API_URL=http://127.0.0.1:27123
OBSIDIAN_API_KEY=your-api-key-here
```

### Setup with Claude Desktop

Add to your Claude Desktop config file (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-mcp/dist/server.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault"
      }
    }
  }
}
```

Restart Claude Desktop and you're ready to go!

📖 **For detailed setup instructions, see [USAGE.md](USAGE.md)**

## Available Tools

The server provides 7 tools for interacting with your Obsidian vault:

### Core Operations

**`read_note`** - Read note contents and metadata
```json
{
  "path": "Daily Notes/2025-11-01.md"
}
```

**`write_note`** - Create or overwrite notes with safety protection
```json
{
  "path": "Projects/new-project.md",
  "content": "# Project\n\nContent here...",
  "overwrite": false
}
```

**`append_note`** - Append content to notes with optional timestamps
```json
{
  "path": "Daily Notes/2025-11-01.md",
  "content": "Completed task",
  "timestamp": true
}
```

### Search & Discovery

**`list_notes`** - List and filter notes with glob patterns
```json
{
  "folder": "Projects",
  "pattern": "*.md",
  "sortBy": "modified",
  "limit": 10
}
```

**`search_notes`** - Full-text search with regex support
```json
{
  "query": "TODO",
  "folder": "Daily Notes",
  "contextLines": 2
}
```

### Daily Notes

**`get_daily_note`** - Get or locate daily note for a specific date
```json
{
  "date": "2025-11-01"
}
```

**`append_to_daily`** - Quick append to today's (or any) daily note
```json
{
  "content": "- [ ] New task",
  "timestamp": true,
  "createIfMissing": true
}
```

## Architecture

### Hybrid Mode (Default)
The server operates in a hybrid mode combining the best of both approaches:

- **Filesystem-first**: Direct file access for speed and reliability
- **API-enhanced**: Optional integration with [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin for:
  - Automatic daily note path detection
  - Plugin integration (Tasks, Templater, etc.)
  - Advanced periodic notes support
- **Graceful fallback**: Automatically falls back to filesystem if API is unavailable

### Technology Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.3+
- **Protocol**: Model Context Protocol (MCP) SDK
- **Validation**: Zod for runtime type safety
- **Testing**: Vitest with comprehensive test coverage

## Configuration Options

### Environment Variables

```env
# Required
OBSIDIAN_VAULT_PATH=/absolute/path/to/vault

# Optional - REST API Integration
OBSIDIAN_API_URL=http://127.0.0.1:27123
OBSIDIAN_API_KEY=your-api-key
OBSIDIAN_VERIFY_SSL=false

# Optional - Logging
LOG_LEVEL=info              # Options: debug, info, warn, error

# Optional - Safety Limits
MAX_FILE_SIZE_MB=10         # Maximum file size to read
ENABLE_DELETE=true          # Allow delete operations

# Optional - Retry Logic
RETRY_MAX_ATTEMPTS=3        # Number of retry attempts
RETRY_BASE_DELAY=100        # Base delay in milliseconds
```

See [USAGE.md](USAGE.md) for detailed configuration instructions.

## Usage Examples

### Basic Note Operations

Ask Claude:
- "Read my note at Daily Notes/2025-11-01.md"
- "Create a new note called Projects/new-idea.md with a heading"
- "Append a task to my daily note"

### Search & Organization

Ask Claude:
- "Search for all notes containing 'TODO' in my Projects folder"
- "List all notes in Daily Notes from the last week"
- "Find notes modified today"

### Daily Note Workflow

Ask Claude:
- "Add a task to today's daily note"
- "Show me yesterday's daily note"
- "Create a daily note for tomorrow with my template"

## Development

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Development mode with hot reload
npm run dev

# Type checking
npm run typecheck
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Development Setup

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/obsidian-mcp.git`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/amazing-feature`
5. Make your changes and add tests
6. Run tests: `npm test`
7. Commit your changes: `git commit -m 'Add amazing feature'`
8. Push to the branch: `git push origin feature/amazing-feature`
9. Open a Pull Request

## Troubleshooting

### Common Issues

**"Vault path not found"**
- Ensure your vault path is absolute, not relative
- Check that the path contains a `.obsidian` folder

**"API unavailable"**
- The server will automatically fall back to filesystem mode
- To use API features, install the Obsidian Local REST API plugin

**"Permission denied"**
- Check file permissions on your vault directory
- On Windows, ensure the path uses forward slashes or escaped backslashes

For more troubleshooting help, see [USAGE.md](USAGE.md#troubleshooting).

## Security

- **Path Validation**: All paths are validated to prevent directory traversal attacks
- **File Size Limits**: Configurable limits prevent reading excessively large files
- **Overwrite Protection**: Write operations require explicit `overwrite: true` flag
- **Delete Protection**: Optional `ENABLE_DELETE` flag to disable delete operations

## License

MIT

## Resources

- [MCP Documentation](https://modelcontextprotocol.io)
- [Obsidian Documentation](https://help.obsidian.md/)
- [Obsidian Local REST API Plugin](https://github.com/coddingtonbear/obsidian-local-rest-api)

## Acknowledgments

- Built with the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk)
- Inspired by other MCP server implementations
- Thanks to the Obsidian community for feedback and testing

---

**Questions or issues?** Please [open an issue](https://github.com/yourusername/obsidian-mcp/issues) on GitHub.
