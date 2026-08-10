# Agent MCP for Chat

An MCP server that gives any chat AI agent capabilities: reading and writing files, precise editing, running commands, and searching code.

Zero build, pure Node.js (ESM), runs over stdio or HTTP (streamable-http / SSE), directly via `npx`.

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

## Transports

No arguments: stdio (default) — point an MCP-compatible client at the command.

`--remote`: listen over HTTP instead. Endpoints:

| Mode | Endpoints |
|------|-----------|
| streamable-http (default) | `POST /mcp` |
| legacy SSE (`--transport sse`) | `GET /sse` + `POST /messages` |

```bash
# streamable-http, random free port (printed to stderr on startup)
npx @shihaoshen/agent-mcp-for-chat --remote

# legacy SSE transport
npx @shihaoshen/agent-mcp-for-chat --remote --transport sse

# fixed port / custom bind address
npx @shihaoshen/agent-mcp-for-chat --remote --port 8080
npx @shihaoshen/agent-mcp-for-chat --remote --host 0.0.0.0   # see Security
```

Options: `--remote`, `--transport http|sse` (only with `--remote`), `--port <n>` (default `0` = OS-assigned free port), `--host <addr>` (default `127.0.0.1`), `--prompt-injection-mode <mode>` (default `default`).

## Prompt Injection

General-purpose chat AIs (ChatGPT, Claude, Gemini, ...) connected via MCP often misuse tools on the first try: relative paths, ambiguous `edit` matches, wrong `cwd`, etc. `--prompt-injection-mode` lets the server push operating instructions to the AI so it works correctly out of the box. Five mutually-exclusive modes:

| Mode | How the prompt reaches the AI | Client support required |
|------|-------------------------------|-------------------------|
| `default` (no flag) | Returns the prompt in the `initialize` response's `instructions` field; clients that honor it inject it as a system message. | Client must read the `instructions` field. |
| `compatible` | Registers an extra `init` tool. The AI calls `init`, receives the prompt text, and acts on it. | Any client that consumes tools — the most compatible. |
| `prompt` | Exposes a named MCP prompt (`agent-instructions`) the client can fetch via `prompts/get`. | Client must implement MCP `prompts`. |
| `resource` | Exposes the prompt as an MCP resource (`agent-mcp://instructions`) the client can fetch via `resources/read`. | Client must implement MCP `resources`. |
| `none` | No prompt is injected at all. | — |

**Client compatibility notes:**

- **Claude Desktop does NOT support MCP `prompts`.** Use `default` (instructions), `compatible` (init tool), or `resource` instead.
- The `default` mode works with Claude Desktop and other clients that read the `initialize` response's `instructions` field.
- The `compatible` mode works with every MCP client that can call tools — the widest coverage.
- The `prompt` mode requires clients like Cline, Continue, or custom integrations that explicitly call `prompts/get`.
- The `resource` mode requires clients that call `resources/read`.

In every mode (including `none`), tool errors are appended a `[HINT] ...` section with specific recovery guidance for that error class (relative path, non-unique `oldText`, command timeout, etc.).

```bash
# Default: instructions field in initialize response
npx @shihaoshen/agent-mcp-for-chat

# Works with any tool-consuming client
npx @shihaoshen/agent-mcp-for-chat --prompt-injection-mode compatible

# Expose via MCP prompts/get (Cline, Continue, ...)
npx @shihaoshen/agent-mcp-for-chat --prompt-injection-mode prompt

# Expose via MCP resources/read
npx @shihaoshen/agent-mcp-for-chat --prompt-injection-mode resource

# No prompt injection; error hints only
npx @shihaoshen/agent-mcp-for-chat --prompt-injection-mode none
```

The injected prompt documents the absolute-path convention, the seven tools' usage rules, and common pitfalls. Error hints cover 16 known error patterns and are appended automatically to `isError` tool results.

## Client Configuration

stdio:

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

streamable-http (start the server with `--remote` first):

```json
{
	"mcpServers": {
		"agent": {
			"url": "http://127.0.0.1:8080/mcp"
		}
	}
}
```

legacy SSE (start the server with `--remote --transport sse` first):

```json
{
	"mcpServers": {
		"agent": {
			"url": "http://127.0.0.1:8080/sse"
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
| `bash` | Run a shell command in `cwd` (absolute, required); optional `timeout` (seconds, no default); optional `shell` to pick the interpreter (Windows: `bash`/`pwsh`/`powershell`/`cmd`; Linux/macOS: `bash`/`fish`/`zsh`; default: auto-detected); output keeps the **tail** 2000 lines / 50KB; non-zero exit code reported as error |
| `grep` | Regex/literal search in `path` (absolute file or directory) with `glob` filter, `ignoreCase`, `context` lines, `limit` (default 100); single lines truncated at 500 chars; skips binary files and node_modules/.git etc. |
| `find` | Find files by glob pattern (`*`/`?`/`**` supported) under `path` (absolute directory), `limit` default 1000 |
| `ls` | List directory `path` (absolute), alphabetical, directories suffixed with `/`, `limit` default 500 |

### Output Truncation Conventions

- Dual limit: 2000 lines or 50KB (UTF-8 bytes), whichever comes first; never returns a partial line
- `read`/`grep`/`find`/`ls` keep the head and append a continuation hint (e.g. `Use offset=N to continue.`)
- `bash` keeps the tail (the most relevant output of a command is usually at the end)

## Security

This server has **no permission system**. It runs with the privileges of the user who started the process; `bash` can execute arbitrary commands and the file tools can read/write any path. Only use it with trusted clients/prompts; containerize it yourself if you need isolation.

With `--remote`, anyone who can reach the HTTP port gets the same capabilities. The server binds `127.0.0.1` by default — only pass `--host 0.0.0.0` (or another external address) on trusted networks, ideally behind a reverse proxy with authentication.

## Development

```bash
npm test                # unit tests (node:test)
npm run test:smoke      # stdio protocol smoke test
npm run test:smoke-http # streamable-http + SSE smoke test
```

## License

MIT

## Special Thanks

[Pi Coding Agent](https://pi.dev)