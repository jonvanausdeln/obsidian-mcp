# Obsidian MCP Server

<div align="center">

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-18+-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.3+-blue.svg)
![Status](https://img.shields.io/badge/status-beta-yellow.svg)

A Model Context Protocol (MCP) server for Obsidian.md that enables AI assistants like Claude to interact with your markdown vault.

[Features](#features) • [Installation](#installation) • [Configuration](#configuration) • [Usage](#usage) • [Documentation](#documentation)

</div>

## Overview

This MCP server provides seamless Obsidian integration for AI assistants, enabling natural interaction with your markdown notes through a comprehensive set of tools. Built with a hybrid architecture combining filesystem reliability with optional REST API features.

## Features

### 14 Tools

#### 📝 Note Operations
- **read_note** - Read a note, a single section, or just its outline • *Filesystem*
- **write_note** - Create or overwrite notes with safety protection • *Filesystem*
- **append_note** - Append content with optional timestamps • *Filesystem*
- **edit_note** - Exact find-and-replace edits, all-or-nothing, without rewriting the note • *Filesystem*
- **update_section** - Replace, append or prepend content under a heading (`Parent > Child` supported) • *Filesystem*
- **delete_note** - Delete a note (requires `confirm: true`, can be disabled with `ENABLE_DELETE=false`) • *Filesystem*
- **update_frontmatter** - Add, update, or remove YAML frontmatter fields • *Filesystem*
- **apply_template** - Apply templates with variable substitution • *Filesystem*

#### 🔍 Search & Discovery
- **list_notes** - List notes with glob patterns, sorting, date filtering and paging • *Filesystem*
- **search_notes** - Text/regex search plus tag and frontmatter filters (works without a query) • *Filesystem*
- **get_tags** - Extract and analyze tags from frontmatter and inline #tags • *Filesystem*

#### 📅 Daily Notes
- **get_daily_note** - Get or locate daily notes with automatic path detection • *Hybrid (API + Filesystem)*
- **append_to_daily** - Quick append to today's daily note with timestamps • *Hybrid (API + Filesystem)*

#### 🖥️ Obsidian App
- **get_active_file** - Get the note currently open in Obsidian • *API only*

> **Legend:**
> - *Filesystem* - Works in both filesystem-only and hybrid modes (no API required)
> - *Hybrid (API + Filesystem)* - Uses REST API when available, falls back to filesystem
> - *API only* - Requires Obsidian REST API plugin and Obsidian to be running

## Installation

### Prerequisites
- Node.js 18 or higher
- An Obsidian vault
- Claude Desktop or another MCP-compatible client
- (Optional) [Obsidian Local REST API plugin](https://github.com/coddingtonbear/obsidian-local-rest-api) for enhanced features

### Quick Start

1. **Clone and install**
```bash
git clone https://github.com/yourusername/obsidian-mcp.git
cd obsidian-mcp
npm install
```

2. **Build the project**
```bash
npm run build
```

## Configuration

### Basic Setup (Filesystem-only)

For basic functionality, only the vault path is required:

**Create `.env` file** (for testing):
```env
OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault
```

### Advanced Setup (Hybrid Mode - Recommended)

For enhanced features like automatic daily note detection and plugin integration:

1. **Install Obsidian Local REST API Plugin**
   - Open Obsidian → Settings → Community plugins
   - Search for "Local REST API"
   - Install and enable the plugin
   - Copy the API key from plugin settings

2. **Configure environment**
```env
OBSIDIAN_VAULT_PATH=/absolute/path/to/your/vault
OBSIDIAN_API_URL=http://127.0.0.1:27123
OBSIDIAN_API_KEY=your-api-key-here
OBSIDIAN_VERIFY_SSL=false
```

### Claude Desktop Setup

Add to your Claude Desktop config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Filesystem-only mode:**
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-mcp/dist/server.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault",
        "LOG_LEVEL": "ERROR"
      }
    }
  }
}
```

**Hybrid mode (recommended):**
```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/obsidian-mcp/dist/server.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/absolute/path/to/your/vault",
        "OBSIDIAN_API_URL": "http://127.0.0.1:27123",
        "OBSIDIAN_API_KEY": "your-api-key-here",
        "LOG_LEVEL": "ERROR"
      }
    }
  }
}
```

Restart Claude Desktop after configuration.

## Usage

Once configured, you can interact with your Obsidian vault through Claude Desktop naturally:

```
"Read my daily note from yesterday"
"Create a new project note called 'MCP Integration' with a standard template"
"Search for all notes containing 'TODO' in my Projects folder"
"Add a task to today's daily note: Review the MCP documentation"
"List all notes tagged with #ai or #mcp"
"Update the frontmatter in my project note to add status: in-progress"
"Apply my meeting template to a new note called 'Team Sync 2025-11-02'"
```

## Documentation

- **[Usage Guide](./USAGE.md)** - Detailed setup, configuration, and usage instructions
- **[Architecture](./CLAUDE.md)** - Project structure and patterns
- **[Roadmap](./.claude/ROADMAP.md)** - Planned features and next steps

## Development

```bash
# Start in development mode with auto-reload
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type checking
npm run typecheck
```

## Troubleshooting

### Common Issues

**"Vault path not found" errors**
- Ensure your vault path is absolute (not relative)
- Check that the directory contains a `.obsidian` folder
- On Windows, use forward slashes: `C:/Users/YourName/vault`

**"API unavailable" warnings**
- The server automatically falls back to filesystem mode
- Install the Obsidian Local REST API plugin for enhanced features
- Verify Obsidian is running and the plugin is enabled

**Permission errors**
- Check file permissions on your vault directory
- Ensure the vault isn't in a restricted location (like System folders)

**Tools not appearing in Claude Desktop**
- Restart Claude Desktop completely after configuration changes
- Verify the path to `dist/server.js` is absolute and correct
- Check the logs in Claude Desktop's developer console

For more detailed troubleshooting, see [USAGE.md](./USAGE.md).

## Architecture

Built with TypeScript and Node.js using:
- **@modelcontextprotocol/sdk** - MCP protocol implementation
- **gray-matter** - YAML frontmatter parsing
- **minimatch** - Glob pattern matching
- **axios** (optional) - REST API client
- **zod** - Runtime type validation

The server uses a hybrid architecture with:
- **Filesystem-first approach** for reliability and speed
- **Optional REST API integration** for advanced features
- **Modular tool-based organization** for maintainability
- **Base class pattern** for consistent error handling
- **Comprehensive logging** with Winston
- **Automatic retry logic** for transient errors

### Operation Modes
- **Filesystem-only**: Direct file access (works offline)
- **Hybrid**: API-first with filesystem fallback (recommended)
- **Benefits**: Automatic daily note detection, plugin integration, graceful degradation

## Contributing

Contributions are welcome! Please see the development setup below:

1. Fork the repository
2. Clone your fork
3. Install dependencies: `npm install`
4. Create a feature branch
5. Make your changes and add tests
6. Run tests: `npm test`
7. Ensure build succeeds: `npm run build`
8. Submit a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Acknowledgments

Built for the [Model Context Protocol](https://modelcontextprotocol.io) ecosystem by Anthropic.

Special thanks to:
- The Obsidian community for inspiration and feedback
- [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin by coddingtonbear
- Other MCP server implementations for patterns and ideas

---

<div align="center">

**Questions?** Open an [issue](../../issues) or start a [discussion](../../discussions)

Made with ❤️ for the MCP community

</div>
