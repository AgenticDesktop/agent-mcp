import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bashTool } from "./tools/bash.js";
import { editTool } from "./tools/edit.js";
import { findTool } from "./tools/find.js";
import { grepTool } from "./tools/grep.js";
import { lsTool } from "./tools/ls.js";
import { readTool } from "./tools/read.js";
import { writeTool } from "./tools/write.js";
import {
	getErrorHint,
	PROMPT_DESCRIPTION,
	PROMPT_NAME,
	RESOURCE_URI,
	SYSTEM_PROMPT,
} from "./prompts.js";

const TOOLS = [readTool, writeTool, editTool, bashTool, grepTool, findTool, lsTool];

const SERVER_INFO = {
	name: "agent-mcp-for-chat",
	version: "0.1.0",
};

/**
 * Create the MCP server with all agent tools registered.
 *
 * Tool handler convention: each tool module exposes
 *   { name, description, schema (zod raw shape), execute(args) }
 * execute() returns { text } or { text, image: {data, mimeType} } and throws
 * Error with a user-facing message on failure (reported as isError content).
 *
 * @param {object} [options]
 * @param {"default"|"compatible"|"prompt"|"resource"|"none"} [options.promptInjectionMode="default"]
 *   - "default": return the prompt in the initialize response's
 *     `instructions` field (clients that honor it inject it as system message).
 *   - "compatible": register an extra `init` tool whose result is the prompt
 *     text (works with any client that consumes tools).
 *   - "prompt": expose a named MCP prompt clients can fetch via prompts/get.
 *   - "resource": expose the prompt as an MCP resource clients can fetch via
 *     resources/read.
 *   - "none": inject no prompt at all (only error-recovery hints remain).
 *   In every mode, tool errors are appended a "[HINT] ..." recovery hint.
 */
export function createAgentMcpServer({ promptInjectionMode = "default" } = {}) {
	const serverOptions =
		promptInjectionMode === "default" ? { instructions: SYSTEM_PROMPT } : {};
	const server = new McpServer(SERVER_INFO, serverOptions);

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
					const hint = getErrorHint(message);
					const text = hint ? `${message}\n\n[HINT] ${hint}` : message;
					return { content: [{ type: "text", text }], isError: true };
				}
			},
		);
	}

	if (promptInjectionMode === "compatible") {
		server.registerTool(
			"init",
			{
				description:
					"Retrieve the operating instructions for the agent-mcp-for-chat tool server. " +
					"Call this once at the start of a session to learn the path conventions, " +
					"per-tool usage rules, and common pitfalls before using any other tool.",
				inputSchema: {},
			},
			async () => ({ content: [{ type: "text", text: SYSTEM_PROMPT }] }),
		);
	}

	if (promptInjectionMode === "prompt") {
		server.registerPrompt(
			PROMPT_NAME,
			{ title: "Agent Instructions", description: PROMPT_DESCRIPTION },
			async () => ({
				messages: [
					{
						role: "user",
						content: { type: "text", text: SYSTEM_PROMPT },
					},
				],
			}),
		);
	}

	if (promptInjectionMode === "resource") {
		server.registerResource(
			PROMPT_NAME,
			RESOURCE_URI,
			{
				title: "Agent Instructions",
				description: PROMPT_DESCRIPTION,
				mimeType: "text/markdown",
			},
			async (uri) => ({
				contents: [
					{
						uri: uri.href,
						mimeType: "text/markdown",
						text: SYSTEM_PROMPT,
					},
				],
			}),
		);
	}

	return server;
}
