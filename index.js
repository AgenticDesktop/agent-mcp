#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createAgentMcpServer } from "./src/server.js";
import { startHttpServer } from "./src/http-server.js";

const args = process.argv.slice(2);

/** Read the value following a flag, e.g. `--port 8080`. Returns undefined if absent. */
function flagValue(flag) {
	const i = args.indexOf(flag);
	return i !== -1 ? args[i + 1] : undefined;
}

if (args.includes("--help") || args.includes("-h")) {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

	console.log(`Agent MCP for Chat v${pkg.version}

${pkg.description}

Usage:
  npx @shihaoshen/agent-mcp-for-chat [options]
  agent-mcp [options]

Options:
  -h, --help              Show this help message and exit
  -v, --version           Show version number and exit
  --remote                Run an HTTP MCP server instead of stdio
  --transport http|sse    Remote transport: streamable-http (default) or
                          legacy SSE. Only valid together with --remote
  --port <n>              Port to listen on (default: 0, a random free port
                          assigned by the OS; printed to stderr on startup)
  --host <addr>           Address to bind (default: 127.0.0.1)
  --prompt-injection-mode <mode>
                          How to expose the operating prompt to the AI:
                            default     return the prompt in the initialize
                                        response's instructions field [default]
                            compatible  register an extra "init" tool whose
                                        result is the prompt (works with any
                                        client that consumes tools)
                            prompt      expose a named MCP prompt clients can
                                        fetch (prompts/get)
                            resource    expose the prompt as an MCP resource
                                        (resources/read)
                            none        inject no prompt (error-recovery
                                        hints still apply)

Transport:
  Without options, runs an MCP server over stdio. Not meant to be invoked
  directly by a human in a terminal -- point an MCP-compatible client at
  this command.

  With --remote, listens over HTTP instead:
    streamable-http (default):  POST http://<host>:<port>/mcp
    sse (--transport sse):      GET  http://<host>:<port>/sse
                                POST http://<host>:<port>/messages

Client configuration (stdio):
  {
    "mcpServers": {
      "agent": {
        "command": "npx",
        "args": ["-y", "@shihaoshen/agent-mcp-for-chat"]
      }
    }
  }

Tools:
  read   Read a file (absolute path), offset/limit pagination
  write  Write a file (absolute path), creates parent dirs, overwrites
  edit   Exact string replacement in a file, atomic, returns a diff
  bash   Run a shell command in an absolute cwd
  grep   Regex/literal search in a file or directory
  find   Find files by glob pattern under an absolute directory
  ls     List a directory (absolute path)

Security:
  No permission system. bash can run arbitrary commands and the file
  tools can read/write any path the OS user can access. Only use with
  trusted clients/prompts.

Docs: see README.md`);
	process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));
	console.log(pkg.version);
	process.exit(0);
}

const remote = args.includes("--remote");
const transportArg = flagValue("--transport");
const promptInjectionMode = flagValue("--prompt-injection-mode") ?? "default";
const VALID_MODES = new Set(["default", "compatible", "prompt", "resource", "none"]);
if (!VALID_MODES.has(promptInjectionMode)) {
	console.error(
		`agent-mcp-for-chat: invalid --prompt-injection-mode "${promptInjectionMode}" (expected "default", "compatible", "prompt", "resource", or "none")`,
	);
	process.exit(1);
}

if (transportArg !== undefined && !remote) {
	console.error("agent-mcp-for-chat: --transport is only valid together with --remote");
	process.exit(1);
}

if (remote) {
	const mode = transportArg ?? "http";
	if (mode !== "http" && mode !== "sse") {
		console.error(`agent-mcp-for-chat: invalid --transport "${mode}" (expected "http" or "sse")`);
		process.exit(1);
	}
	const portArg = flagValue("--port");
	const port = portArg === undefined ? 0 : Number(portArg);
	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		console.error(`agent-mcp-for-chat: invalid --port "${portArg}"`);
		process.exit(1);
	}
	const host = flagValue("--host") ?? "127.0.0.1";

	const { port: actualPort } = await startHttpServer({ mode, host, port, promptInjectionMode });

	const base = `http://${host}:${actualPort}`;
	console.error(`agent-mcp-for-chat: MCP server listening on ${base}`);
	if (mode === "http") {
		console.error(`agent-mcp-for-chat: streamable-http endpoint: POST ${base}/mcp`);
	} else {
		console.error(`agent-mcp-for-chat: sse endpoints: GET ${base}/sse, POST ${base}/messages`);
	}
	console.error("agent-mcp-for-chat: all path arguments must be absolute");
	console.error(`agent-mcp-for-chat: prompt injection mode: ${promptInjectionMode}`);
	if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
		console.error(
			"agent-mcp-for-chat: WARNING: server is reachable from other machines; " +
				"tools can run arbitrary commands and read/write files. Use only on trusted networks.",
		);
	}
} else {
	const server = createAgentMcpServer({ promptInjectionMode });
	const transport = new StdioServerTransport();

	await server.connect(transport);

	// MCP servers log to stderr; stdout is reserved for the protocol.
	console.error("agent-mcp-for-chat: MCP server running on stdio");
	console.error("agent-mcp-for-chat: all path arguments must be absolute");
	console.error(`agent-mcp-for-chat: prompt injection mode: ${promptInjectionMode}`);
}
