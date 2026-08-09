#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentMcpServer } from "./src/server.js";

const server = createAgentMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);

// MCP servers log to stderr; stdout is reserved for the protocol.
console.error("agent-mcp-for-chat: MCP server running on stdio");
console.error("agent-mcp-for-chat: all path arguments must be absolute");
