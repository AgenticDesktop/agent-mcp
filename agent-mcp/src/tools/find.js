import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { relativeDisplay, resolvePath } from "../lib/paths.js";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "../lib/truncate.js";
import { matchGlob, walk } from "../lib/walk.js";

const DEFAULT_LIMIT = 1000;

export const findTool = {
	name: "find",
	description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Skips common directories (node_modules, .git, dist, etc). Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
	schema: {
		pattern: z
			.string()
			.describe("Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'"),
		path: z.string().optional().describe("Directory to search in (default: working directory)"),
		limit: z.number().optional().describe(`Maximum number of results (default: ${DEFAULT_LIMIT})`),
	},
	async execute({ pattern, path: searchDir, limit }) {
		const searchPath = resolvePath(searchDir || ".");
		const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);

		try {
			const searchStat = await stat(searchPath);
			if (!searchStat.isDirectory()) {
				throw new Error(`Not a directory: ${relativeDisplay(searchPath)}`);
			}
		} catch (err) {
			if (err.message.startsWith("Not a directory")) throw err;
			throw new Error(`Path not found: ${relativeDisplay(searchPath)}`);
		}

		const results = [];
		let resultLimitReached = false;
		for await (const file of walk(searchPath)) {
			const rel = path.relative(searchPath, file).split(path.sep).join("/");
			if (!matchGlob(rel, pattern)) continue;
			results.push(rel);
			if (results.length >= effectiveLimit) {
				resultLimitReached = true;
				break;
			}
		}

		results.sort((a, b) => a.localeCompare(b));

		if (results.length === 0) return { text: "No files found matching pattern" };

		const truncation = truncateHead(results.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
		let output = truncation.content;
		const notices = [];
		if (resultLimitReached) {
			notices.push(
				`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
			);
		}
		if (truncation.truncated) {
			notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
		}
		if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
		return { text: output };
	},
};
