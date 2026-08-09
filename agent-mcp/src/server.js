import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bashTool } from "./tools/bash.js";
import { cwdTool } from "./tools/cwd.js";
import { editTool } from "./tools/edit.js";
import { findTool } from "./tools/find.js";
import { grepTool } from "./tools/grep.js";
import { lsTool } from "./tools/ls.js";
import { readTool } from "./tools/read.js";
import { writeTool } from "./tools/write.js";

const TOOLS = [cwdTool, readTool, writeTool, editTool, bashTool, grepTool, findTool, lsTool];

/**
 * Create the MCP server with all agent tools registered.
 * Tool handler convention: each tool module exposes
 *   { name, description, schema (zod raw shape), execute(args) }
 * execute() returns { text } or { text, image: {data, mimeType} } and throws
 * Error with a user-facing message on failure (reported as isError content).
 */
export function createAgentMcpServer() {
	const server = new McpServer({
		name: "agent-mcp-for-chat",
		version: "0.1.0",
	});

	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{
				description: tool.description,
				inputSchema: tool.schema,
			},
			async (args) => {
				try {
					const result = await tool.execute(args ?? {});
					const content = [];
					if (result.text !== undefined) {
						content.push({ type: "text", text: result.text });
					}
					if (result.image) {
						content.push({
							type: "image",
							data: result.image.data,
							mimeType: result.image.mimeType,
						});
					}
					return { content };
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return { content: [{ type: "text", text: message }], isError: true };
				}
			},
		);
	}

	return server;
}
