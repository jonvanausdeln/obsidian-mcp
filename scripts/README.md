# Scripts

Utility scripts for testing and development of the Obsidian MCP Server.

## Available Scripts

### Testing Scripts

#### `functional-test.ts`
Comprehensive functional test that validates the entire MCP server with a real Obsidian vault.

**Usage:**
```bash
npm run test:functional
```

**What it tests:**
- Configuration loading from `.env`
- Logger initialization
- FileSystemClient operations
- MCP tool registration and execution
- Error handling (missing files, invalid paths, validation)
- Integration with real vault

**Output:**
- ✅/❌ Test results with details
- Summary statistics (pass rate, total tests)
- Next steps if all tests pass

---

#### `create-test-note.ts`
Creates a comprehensive test note in your Obsidian vault for testing MCP operations.

**Usage:**
```bash
npm run test:create-note
```

**What it creates:**
A markdown file (`MCP Test Note.md`) containing:
- YAML frontmatter with metadata
- Various markdown features (headings, lists, tables, code blocks)
- Obsidian-specific features (callouts, tags, links)
- Special characters and Unicode
- Sample data for search testing

**Location:** `<your-vault>/MCP Test Note.md`

---

#### `test-read-note.ts`
Quick test to verify the `read_note` tool works with the test note.

**Usage:**
```bash
npm run test:read-note
```

**What it does:**
- Reads the MCP Test Note
- Displays file statistics
- Shows content preview
- Extracts and displays frontmatter
- Counts markdown sections

---

## Development Workflow

### First Time Setup

1. Configure your vault in `.env`:
   ```bash
   OBSIDIAN_VAULT_PATH="/path/to/your/vault"
   ```

2. Create the test note:
   ```bash
   npm run test:create-note
   ```

3. Run functional tests:
   ```bash
   npm run test:functional
   ```

### Regular Testing

```bash
# Unit tests (fast, no vault needed)
npm test

# Functional tests (requires vault)
npm run test:functional

# Quick read test
npm run test:read-note

# All tests
npm test -- --run && npm run test:functional
```

### Before Committing

```bash
# Run all checks
npm run typecheck
npm run build
npm test -- --run
npm run test:functional
```

---

## Script Details

### Dependencies

All scripts use:
- **tsx** - TypeScript execution
- **dotenv** - Environment variable loading
- **src/utils/** - Shared utilities (config, logger, retry)
- **src/obsidian/** - FileSystemClient
- **src/tools/** - MCP tools

### Error Handling

Scripts follow these conventions:
- Exit code `0` on success
- Exit code `1` on failure
- Detailed error messages with context
- Colored output (✅ green, ❌ red)

### Configuration

Scripts read configuration from `.env`:
- `OBSIDIAN_VAULT_PATH` - Required
- `LOG_LEVEL` - Optional (default: info)
- `MAX_FILE_SIZE_MB` - Optional (default: 10)
- See `.env.example` for all options

---

## Adding New Scripts

To add a new utility script:

1. Create `scripts/your-script.ts`
2. Add shebang: `#!/usr/bin/env tsx`
3. Import dependencies from `../src/`
4. Add error handling with exit codes
5. Update `package.json` scripts:
   ```json
   "your-script": "tsx scripts/your-script.ts"
   ```
6. Document here in this README

---

## Troubleshooting

### "Vault path does not exist"
- Check `OBSIDIAN_VAULT_PATH` in `.env`
- Use absolute paths
- Ensure `.obsidian` folder exists in vault

### "tsx: command not found"
- Use npm scripts instead of direct tsx
- Scripts run via `npm run` have correct PATH

### "Permission denied"
- Check vault folder permissions
- Ensure write access for test note creation

### Tests fail but vault works in Obsidian
- Check `.obsidian` folder exists
- Verify markdown files have `.md` extension
- Try running `npm run test:functional` for detailed output

---

## Future Scripts

Planned utility scripts:
- `migrate-vault.ts` - Migrate notes between vaults
- `analyze-vault.ts` - Generate vault statistics
- `benchmark.ts` - Performance testing
- `demo.ts` - Interactive demo of MCP tools

---

*Last updated: 2025-11-01 - Session 2*
