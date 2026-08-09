import { z } from "zod";
import { requireCwd } from "../lib/paths.js";
import { execShell } from "../lib/shell.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from "../lib/truncate.js";

export const bashTool = {
	name: "bash",
	description: `Execute a shell command in the working directory set via the cwd tool. Returns stdout and stderr combined. Output is truncated to the last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Optionally provide a timeout in seconds (no default timeout).`,
	schema: {
		command: z.string().describe("Shell command to execute"),
		timeout: z.number().optional().describe("Timeout in seconds (optional, no default timeout)"),
	},
	async execute({ command, timeout }) {
		const cwd = requireCwd();

		// Accumulate output, keeping memory bounded: once we exceed the cap we
		// keep only the tail (final truncation happens at the end anyway).
		const chunks = [];
		let buffered = 0;
		const HARD_CAP = DEFAULT_MAX_BYTES * 4;
		const onData = (data) => {
			chunks.push(data);
			buffered += data.length;
			if (buffered > HARD_CAP) {
				const merged = Buffer.concat(chunks);
				const tail = merged.subarray(merged.length - HARD_CAP);
				chunks.length = 0;
				chunks.push(tail);
				buffered = tail.length;
			}
		};

		let exitCode;
		try {
			const result = await execShell(command, cwd, { onData, timeout });
			exitCode = result.exitCode;
		} catch (err) {
			if (err instanceof Error && err.message.startsWith("timeout:")) {
				const partial = formatBashOutput(Buffer.concat(chunks).toString("utf-8"));
				throw new Error(appendStatus(partial, `Command timed out after ${timeout} seconds`));
			}
			throw err;
		}

		const output = formatBashOutput(Buffer.concat(chunks).toString("utf-8"));
		if (exitCode !== 0 && exitCode !== null) {
			throw new Error(appendStatus(output, `Command exited with code ${exitCode}`));
		}
		return { text: output };
	},
};

function formatBashOutput(raw) {
	const text = raw || "(no output)";
	if (!raw) return text;
	const truncation = truncateTail(raw);
	if (!truncation.truncated) return raw;
	let output = truncation.content;
	const startLine = truncation.totalLines - truncation.outputLines + 1;
	const endLine = truncation.totalLines;
	if (truncation.lastLinePartial) {
		output += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine}]`;
	} else if (truncation.truncatedBy === "lines") {
		output += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}]`;
	} else {
		output += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit)]`;
	}
	return output;
}

function appendStatus(text, status) {
	return `${text ? `${text}\n\n` : ""}${status}`;
}
