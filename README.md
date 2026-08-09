# Agent MCP for Chat

An MCP server that gives any chat AI agent capabilities: reading and writing files, precise editing, running commands, and searching code.

Zero build, pure Node.js (ESM), stdio transport, runs directly via `npx`.

## Quick Start

```bash
npx @shihaoshen/agent-mcp-for-chat
```

Local development:

```bash
git clone <repo> && cd agent-mcp
npm install
node index.js        # or npm start
```

## Client Configuration

```json
{
	"mcpServers": {
		"agent": {
			"command": "npx",
			"args": ["-y", "@shihaoshen/agent-mcp-for-chat"]
		}
	}
}
```

## Paths: Absolute Only

**All path arguments must be absolute.** Relative paths are rejected with a guiding error. There is no session state — every call is self-contained:

```
AI:  read(path="D:\\projects\\my-app\\src\\index.ts")     → absolute path required
AI:  bash(command="npm test", cwd="D:\\projects\\my-app") → cwd selects the run directory
AI:  grep(pattern="TODO", path="D:\\projects\\my-app")    → directory to search
```

## Tools

| Tool | Description |
|------|-------------|
| `read` | Read a file (`path`, absolute) with `offset`/`limit` pagination (1-indexed); images (jpg/png/gif/webp/bmp) returned as attachments; truncated at 2000 lines / 50KB |
| `write` | Write a file (`path`, absolute), auto-creating parent directories, overwriting existing files |
| `edit` | Exact string replacement in a file (`path`, absolute): `edits: [{oldText, newText}]`; oldText must be unique in the file, edits must not overlap, applied atomically; preserves CRLF/LF line endings and BOM; returns a unified diff |
| `bash` | Run a shell command in `cwd` (absolute, required) — Windows: cmd, Unix: sh; optional `timeout` (seconds, no default); output keeps the **tail** 2000 lines / 50KB; non-zero exit code reported as error |
| `grep` | Regex/literal search in `path` (absolute file or directory) with `glob` filter, `ignoreCase`, `context` lines, `limit` (default 100); single lines truncated at 500 chars; skips binary files and node_modules/.git etc. |
| `find` | Find files by glob pattern (`*`/`?`/`**` supported) under `path` (absolute directory), `limit` default 1000 |
| `ls` | List directory `path` (absolute), alphabetical, directories suffixed with `/`, `limit` default 500 |

### Output Truncation Conventions

- Dual limit: 2000 lines or 50KB (UTF-8 bytes), whichever comes first; never returns a partial line
- `read`/`grep`/`find`/`ls` keep the head and append a continuation hint (e.g. `Use offset=N to continue.`)
- `bash` keeps the tail (the most relevant output of a command is usually at the end)

## Security

This server has **no permission system**. It runs with the privileges of the user who started the process; `bash` can execute arbitrary commands and the file tools can read/write any path. Only use it with trusted clients/prompts; containerize it yourself if you need isolation.

## Development

```bash
npm test           # unit tests (node:test)
npm run test:smoke # stdio protocol smoke test
```

## License

MIT

## Special Thanks

[Pi Coding Agent](https://pi.dev)