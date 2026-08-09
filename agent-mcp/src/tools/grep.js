import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { relativeDisplay, resolvePath } from "../lib/paths.js";
import {
	DEFAULT_MAX_BYTES,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	truncateHead,
	truncateLine,
} from "../lib/truncate.js";
import { matchGlob, walk } from "../lib/walk.js";

const DEFAULT_LIMIT = 100;
const BINARY_SNIFF_BYTES = 8192;

function escapeRegExp(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function isBinaryFile(filePath) {
	let handle;
	try {
		handle = await readFile(filePath);
	} catch {
		return true; // unreadable: skip
	}
	const sniff = handle.subarray(0, BINARY_SNIFF_BYTES);
	return sniff.includes(0);
}

export const grepTool = {
	name: "grep",
	description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Skips binary files and common directories (node_modules, .git, dist, etc). Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
	schema: {
		pattern: z.string().describe("Search pattern (regex or literal string)"),
		path: z.string().optional().describe("Directory or file to search (default: working directory)"),
		glob: z.string().optional().describe("Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"),
		ignoreCase: z.boolean().optional().describe("Case-insensitive search (default: false)"),
		literal: z.boolean().optional().describe("Treat pattern as literal string instead of regex (default: false)"),
		context: z
			.number()
			.optional()
			.describe("Number of lines to show before and after each match (default: 0)"),
		limit: z.number().optional().describe(`Maximum number of matches to return (default: ${DEFAULT_LIMIT})`),
	},
	async execute({ pattern, path: searchDir, glob, ignoreCase, literal, context, limit }) {
		const searchPath = resolvePath(searchDir || ".");
		const contextValue = context && context > 0 ? Math.floor(context) : 0;
		const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);

		let regex;
		try {
			regex = new RegExp(literal ? escapeRegExp(pattern) : pattern, ignoreCase ? "i" : "");
		} catch (err) {
			throw new Error(`Invalid regex pattern: ${err.message}`);
		}

		let searchStat;
		try {
			searchStat = await stat(searchPath);
		} catch {
			throw new Error(`Path not found: ${relativeDisplay(searchPath)}`);
		}

		// Collect candidate files.
		const files = [];
		if (searchStat.isDirectory()) {
			for await (const file of walk(searchPath)) {
				const rel = path.relative(searchPath, file).split(path.sep).join("/");
				if (glob && !matchGlob(rel, glob)) continue;
				files.push({ absolute: file, display: rel });
			}
			files.sort((a, b) => a.display.localeCompare(b.display));
		} else {
			files.push({ absolute: searchPath, display: path.basename(searchPath) });
		}

		// Pass 1: stream each file, collect matching line numbers (stop at limit).
		/** @type {Array<{ display: string, absolute: string, lineNo: number }>} */
		const matches = [];
		let matchLimitReached = false;
		for (const file of files) {
			if (matchLimitReached) break;
			if (await isBinaryFile(file.absolute)) continue;
			const rl = createInterface({
				input: createReadStream(file.absolute, "utf-8"),
				crlfDelay: Infinity,
			});
			let lineNo = 0;
			for await (const rawLine of rl) {
				lineNo++;
				regex.lastIndex = 0;
				if (regex.test(rawLine)) {
					matches.push({ display: file.display, absolute: file.absolute, lineNo });
					if (matches.length >= effectiveLimit) {
						matchLimitReached = true;
						rl.destroy();
						break;
					}
				}
			}
		}

		if (matches.length === 0) return { text: "No matches found" };

		// Pass 2: load files with matches and format output blocks.
		// Match lines:   "file:N: text"
		// Context lines: "file-N- text"  (same style as pi)
		const lineCache = new Map(); // absolute -> string[]
		const getLines = async (absolute) => {
			let lines = lineCache.get(absolute);
			if (!lines) {
				const content = await readFile(absolute, "utf-8");
				lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
				lineCache.set(absolute, lines);
			}
			return lines;
		};

		const outputLines = [];
		let linesTruncated = false;
		const push = (prefix, lineNo, separator, text) => {
			const t = truncateLine(text);
			if (t.wasTruncated) linesTruncated = true;
			outputLines.push(`${prefix}${separator}${lineNo}${separator} ${t.text}`);
		};

		for (const match of matches) {
			const lines = await getLines(match.absolute);
			if (contextValue > 0) {
				const start = Math.max(1, match.lineNo - contextValue);
				const end = Math.min(lines.length, match.lineNo + contextValue);
				for (let current = start; current <= end; current++) {
					const isMatch = current === match.lineNo;
					push(match.display, current, isMatch ? ":" : "-", lines[current - 1] ?? "");
				}
			} else {
				push(match.display, match.lineNo, ":", lines[match.lineNo - 1] ?? "");
			}
		}

		const truncation = truncateHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
		let output = truncation.content;
		const notices = [];
		if (matchLimitReached) {
			notices.push(
				`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
			);
		}
		if (truncation.truncated) {
			notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
		}
		if (linesTruncated) {
			notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
		}
		if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
		return { text: output };
	},
};
