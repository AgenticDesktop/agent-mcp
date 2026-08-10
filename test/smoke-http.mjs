/**
 * HTTP smoke test: spawn the server with --remote (streamable-http) and
 * --remote --transport sse, verify initialize -> tools/list over HTTP.
 *
 * The server binds a random free port by default; the actual address is
 * parsed from its stderr log line "listening on http://<host>:<port>".
 *
 * Run: node test/smoke-http.mjs
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const serverEntry = fileURLToPath(new URL("../index.js", import.meta.url));
const EXPECTED_TOOLS = ["bash", "edit", "find", "grep", "ls", "read", "write"];

/** Spawn the server and resolve with { child, baseUrl } once it reports listening. */
function startServer(extraArgs) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [serverEntry, ...extraArgs], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`server did not start in time. stderr:\n${stderr}`));
		}, 15000);
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
			const match = stderr.match(/listening on (http:\/\/\S+)/);
			if (match) {
				clearTimeout(timer);
				resolve({ child, baseUrl: match[1] });
			}
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`server exited early with code ${code}. stderr:\n${stderr}`));
		});
	});
}

async function smokeRemote(label, extraArgs, makeTransport) {
	const { child, baseUrl } = await startServer(extraArgs);
	const client = new Client({ name: "agent-mcp-smoke-http", version: "0.1.0" });
	try {
		await client.connect(makeTransport(baseUrl));
		console.log(`[smoke:${label}] initialize OK (${baseUrl})`);

		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name).sort();
		assert.deepEqual(names, EXPECTED_TOOLS);
		console.log(`[smoke:${label}] tools/list OK: ${names.join(", ")}`);

		const lsResult = await client.callTool({ name: "ls", arguments: { path: process.cwd() } });
		assert.ok(lsResult.content[0].text.length > 0);
		console.log(`[smoke:${label}] tools/call ls OK`);
	} finally {
		await client.close();
		child.kill();
	}
}

await smokeRemote("http", ["--remote"], (base) => new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
await smokeRemote(
	"sse",
	["--remote", "--transport", "sse"],
	(base) => new SSEClientTransport(new URL(`${base}/sse`)),
);

console.log("[smoke] ALL PASSED");
