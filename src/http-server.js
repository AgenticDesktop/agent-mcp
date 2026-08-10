import { createServer } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAgentMcpServer } from "./server.js";

const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MB

/**
 * Read and JSON-parse a request body with a size limit.
 * Resolves to undefined for empty bodies. Throws on invalid JSON or overflow.
 */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolve(undefined);
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new Error("invalid JSON body"));
			}
		});
		req.on("error", reject);
	});
}

function sendJson(res, status, obj) {
	const data = JSON.stringify(obj);
	res.writeHead(status, { "content-type": "application/json" });
	res.end(data);
}

const JSONRPC_PARSE_ERROR = {
	jsonrpc: "2.0",
	error: { code: -32700, message: "Parse error" },
	id: null,
};

/**
 * Handle a single Streamable HTTP request in stateless mode:
 * a fresh server+transport pair per request, closed when the response ends.
 */
async function handleStreamableRequest(req, res) {
	const server = createAgentMcpServer();
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
	});
	res.on("close", () => {
		transport.close().catch(() => {});
		server.close().catch(() => {});
	});
	await server.connect(transport);
	let body;
	try {
		body = await readJsonBody(req);
	} catch {
		sendJson(res, 400, JSONRPC_PARSE_ERROR);
		return;
	}
	await transport.handleRequest(req, res, body);
}

/**
 * Start an HTTP MCP server.
 * @param {object} opts
 * @param {"http"|"sse"} opts.mode - "http" = Streamable HTTP (POST /mcp),
 *   "sse" = legacy SSE (GET /sse + POST /messages)
 * @param {string} opts.host
 * @param {number} opts.port - 0 means the OS assigns a free port
 * @returns {Promise<{server: import("node:http").Server, port: number, host: string}>}
 */
export async function startHttpServer({ mode, host, port }) {
	/** @type {Map<string, SSEServerTransport>} sessionId -> transport (sse mode) */
	const sseTransports = new Map();

	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

			if (mode === "http") {
				if (url.pathname === "/mcp") {
					await handleStreamableRequest(req, res);
				} else {
					sendJson(res, 404, { error: "not found" });
				}
				return;
			}

			// mode === "sse"
			if (url.pathname === "/sse" && req.method === "GET") {
				const mcpServer = createAgentMcpServer();
				const transport = new SSEServerTransport("/messages", res);
				sseTransports.set(transport.sessionId, transport);
				transport.onclose = () => {
					sseTransports.delete(transport.sessionId);
					mcpServer.close().catch(() => {});
				};
				await mcpServer.connect(transport);
				return;
			}
			if (url.pathname === "/messages" && req.method === "POST") {
				const sessionId = url.searchParams.get("sessionId");
				const transport = sessionId ? sseTransports.get(sessionId) : undefined;
				if (!transport) {
					sendJson(res, 400, { error: "unknown or missing sessionId" });
					return;
				}
				let body;
				try {
					body = await readJsonBody(req);
				} catch {
					sendJson(res, 400, JSONRPC_PARSE_ERROR);
					return;
				}
				await transport.handlePostMessage(req, res, body);
				return;
			}
			if (url.pathname === "/sse" || url.pathname === "/messages") {
				sendJson(res, 405, { error: "method not allowed" });
				return;
			}
			sendJson(res, 404, { error: "not found" });
		} catch (err) {
			console.error("agent-mcp-for-chat: request error:", err);
			if (!res.headersSent) {
				sendJson(res, 500, { error: "internal server error" });
			} else {
				res.end();
			}
		}
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, resolve);
	});

	const address = server.address();
	const actualPort = typeof address === "object" && address ? address.port : port;

	// Graceful shutdown: close idle listener and all active SSE transports.
	const shutdown = () => {
		for (const transport of sseTransports.values()) {
			transport.close().catch(() => {});
		}
		sseTransports.clear();
		server.close();
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);

	return { server, port: actualPort, host };
}
