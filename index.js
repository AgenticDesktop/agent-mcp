#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createAgentMcpServer } from "./src/server.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

	console.log(`Agent MCP for Chat v${pkg.version}

${pkg.description}

Usage:
  npx @shihaoshen/agent-mcp-for-chat [options]
  agent-mcp [options]

Options:
  -h, --help     Show this help message and exit
  -v, --version  Show version number and exit

Transport:
  Runs an MCP server over stdio. Not meant to be invoked directly by a
  human in a terminal -- point an MCP-compatible client at this command.

Client configuration:
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

const server = createAgentMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);

// MCP servers log to stderr; stdout is reserved for the protocol.
console.error("agent-mcp-for-chat: MCP server running on stdio");
console.error("agent-mcp-for-chat: all path arguments must be absolute");
