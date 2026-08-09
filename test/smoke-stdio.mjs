/**
 * Stdio smoke test: spawn the server as a real MCP server process and verify
 * the initialize -> tools/list -> tools/call chain over stdio JSON-RPC.
 *
 * Run: node test/smoke-stdio.mjs
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverEntry = fileURLToPath(new URL("../index.js", import.meta.url));

const workDir = await mkdtemp(path.join(tmpdir(), "agent-mcp-smoke-"));
await writeFile(path.join(workDir, "smoke.txt"), "smoke-line-1\nsmoke-line-2\n");

const transport = new StdioClientTransport({
	command: process.execPath,
	args: [serverEntry],
	stderr: "pipe",
});

const client = new Client({ name: "agent-mcp-smoke", version: "0.1.0" });

try {
	await client.connect(transport);
	console.log("[smoke] initialize OK");

	// tools/list
	const { tools } = await client.listTools();
	const names = tools.map((t) => t.name).sort();
	assert.deepEqual(names, ["bash", "edit", "find", "grep", "ls", "read", "write"]);
	console.log(`[smoke] tools/list OK: ${names.join(", ")}`);

	// Relative paths must be rejected with a guiding error.
	const relativeRead = await client.callTool({ name: "read", arguments: { path: "smoke.txt" } });
	assert.equal(relativeRead.isError, true);
	assert.match(relativeRead.content[0].text, /Path must be absolute/);
	console.log("[smoke] relative-path guard OK");

	// read via absolute path.
	const readResult = await client.callTool({ name: "read", arguments: { path: path.join(workDir, "smoke.txt") } });
	assert.match(readResult.content[0].text, /smoke-line-1/);
	console.log("[smoke] read OK");

	// write + grep roundtrip.
	const roundtrip = path.join(workDir, "roundtrip.txt");
	await client.callTool({ name: "write", arguments: { path: roundtrip, content: "roundtrip-token\n" } });
	const grepResult = await client.callTool({
		name: "grep",
		arguments: { pattern: "roundtrip-token", path: workDir },
	});
	assert.match(grepResult.content[0].text, /roundtrip\.txt:1: roundtrip-token/);
	console.log("[smoke] write+grep OK");

	// bash echo in the given cwd.
	const bashResult = await client.callTool({
		name: "bash",
		arguments: { command: "echo smoke-bash", cwd: workDir, timeout: 30 },
	});
	assert.match(bashResult.content[0].text, /smoke-bash/);
	console.log("[smoke] bash OK");

	console.log("[smoke] ALL PASSED");
} finally {
	await client.close();
	await rm(workDir, { recursive: true, force: true });
}
