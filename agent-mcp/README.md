# @shihaoshen/agent-mcp-for-chat

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

## Workflow: Set the Working Directory First

**You must call the `cwd` tool to set the working directory before using any other tool.** Otherwise every other tool call fails with an error that guides the AI to set it.

```
AI:  cwd(path="D:\\projects\\my-app")     → Working directory set to: D:\projects\my-app
AI:  cwd()                                → Current working directory: D:\projects\my-app
AI:  read(path="src/index.ts")            → relative paths resolve against the cwd
AI:  bash(command="npm test")             → executed in that directory
```

## Tools

| Tool | Description |
|------|-------------|
| `cwd` | Set/query the session working directory (prerequisite for all other tools) |
| `read` | Read a file with `offset`/`limit` pagination (1-indexed); images (jpg/png/gif/webp/bmp) returned as attachments; truncated at 2000 lines / 50KB |
| `write` | Write a file, auto-creating parent directories, overwriting existing files |
| `edit` | Exact string replacement: `edits: [{oldText, newText}]`; oldText must be unique in the file, edits must not overlap, applied atomically; preserves CRLF/LF line endings and BOM; returns a unified diff |
| `bash` | Run a shell command in the working directory (Windows: cmd, Unix: sh); optional `timeout` (seconds, no default); output keeps the **tail** 2000 lines / 50KB; non-zero exit code reported as error |
| `grep` | Regex/literal search with `glob` filter, `ignoreCase`, `context` lines, `limit` (default 100); single lines truncated at 500 chars; skips binary files and node_modules/.git etc. |
| `find` | Find files by glob pattern (`*`/`?`/`**` supported), `limit` default 1000 |
| `ls` | List directory contents, alphabetical, directories suffixed with `/`, `limit` default 500 |

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