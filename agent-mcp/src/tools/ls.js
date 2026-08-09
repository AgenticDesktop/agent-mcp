import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolvePath } from "../lib/paths.js";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "../lib/truncate.js";

const DEFAULT_LIMIT = 500;

export const lsTool = {
	name: "ls",
	description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
	schema: {
		path: z.string().describe("Absolute path of the directory to list"),
		limit: z.number().optional().describe(`Maximum number of entries to return (default: ${DEFAULT_LIMIT})`),
	},
	async execute({ path: dirPath, limit }) {
		const absolute = resolvePath(dirPath);
		const display = absolute;
		const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);

		let dirStat;
		try {
			dirStat = await stat(absolute);
		} catch {
			throw new Error(`Path not found: ${display}`);
		}
		if (!dirStat.isDirectory()) {
			throw new Error(`Not a directory: ${display}`);
		}

		let entries;
		try {
			entries = await readdir(absolute);
		} catch (err) {
			throw new Error(`Cannot read directory: ${err.message}`);
		}

		entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

		const results = [];
		let entryLimitReached = false;
		for (const entry of entries) {
			if (results.length >= effectiveLimit) {
				entryLimitReached = true;
				break;
			}
			let suffix = "";
			try {
				const entryStat = await stat(path.join(absolute, entry));
				if (entryStat.isDirectory()) suffix = "/";
			} catch {
				continue; // skip entries we cannot stat
			}
			results.push(entry + suffix);
		}

		if (results.length === 0) return { text: "(empty directory)" };

		const truncation = truncateHead(results.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
		let output = truncation.content;
		const notices = [];
		if (entryLimitReached) {
			notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`);
		}
		if (truncation.truncated) {
			notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
		}
		if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
		return { text: output };
	},
};
