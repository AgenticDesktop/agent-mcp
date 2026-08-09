import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { withFileMutationQueue } from "../lib/mutation-queue.js";
import { relativeDisplay, resolvePath } from "../lib/paths.js";

const BOM = "﻿";
const DIFF_CONTEXT_LINES = 2;
// Guard: skip diff computation for very large files (LCS is O(n*m)).
const DIFF_MAX_CELL_COUNT = 4_000_000;

function detectLineEnding(text) {
	const crlf = text.indexOf("\r\n");
	const lf = text.indexOf("\n");
	if (lf === -1) return "\n"; // no newlines at all
	if (crlf !== -1 && crlf === lf - 1) return "\r\n";
	return "\n";
}

function normalizeToLF(text) {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function toLineEnding(text, eol) {
	return eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/** Find all start offsets of needle in haystack. */
function findAll(haystack, needle) {
	const offsets = [];
	let idx = haystack.indexOf(needle);
	while (idx !== -1) {
		offsets.push(idx);
		idx = haystack.indexOf(needle, idx + 1);
	}
	return offsets;
}

/** Apply edits to LF-normalized content. Returns new content or throws. */
function applyEdits(content, edits, display) {
	// Collect match ranges first so we can detect overlaps.
	const ranges = [];
	for (const [i, edit] of edits.entries()) {
		const oldText = normalizeToLF(edit.oldText);
		const newText = normalizeToLF(edit.newText);
		if (oldText === "") {
			throw new Error(`oldText must not be empty in ${display}.`);
		}
		if (oldText === newText) {
			throw new Error(`Edit ${i + 1} in ${display}: oldText and newText are identical, nothing to change.`);
		}
		const offsets = findAll(content, oldText);
		if (offsets.length === 0) {
			throw new Error(
				`Edit ${i + 1} in ${display}: oldText not found. Make sure it matches the file contents exactly, including whitespace and indentation.`,
			);
		}
		if (offsets.length > 1) {
			throw new Error(
				`Edit ${i + 1} in ${display}: oldText found ${offsets.length} times. It must match exactly one location; include more surrounding context to make it unique.`,
			);
		}
		ranges.push({ start: offsets[0], end: offsets[0] + oldText.length, newText });
	}

	// Overlap detection.
	const sorted = [...ranges].sort((a, b) => a.start - b.start);
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].start < sorted[i - 1].end) {
			throw new Error(`Edits in ${display} overlap. Combine overlapping edits into a single edit.`);
		}
	}

	// Apply from the end backwards so offsets stay valid.
	let result = content;
	for (let i = sorted.length - 1; i >= 0; i--) {
		const { start, end, newText } = sorted[i];
		result = result.slice(0, start) + newText + result.slice(end);
	}
	return result;
}

/** Minimal LCS-based unified diff on lines, with context. */
function unifiedDiff(oldText, newText, display) {
	const a = oldText.split("\n");
	const b = newText.split("\n");
	if (a.length * b.length > DIFF_MAX_CELL_COUNT) {
		return null; // too large; caller falls back to a summary
	}

	// LCS table (lengths), computed on trimmed trailing common parts for speed.
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const midA = a.slice(start, endA);
	const midB = b.slice(start, endB);

	const m = midA.length;
	const n = midB.length;
	// dp[i][j] = LCS length of midA[i:], midB[j:]
	const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	// Walk the table to produce ops: {type: ' '|'-'|'+', line, oldNo?, newNo?}
	const ops = [];
	for (let i = 0; i < start; i++) ops.push({ type: " ", line: a[i] });
	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		if (midA[i] === midB[j]) {
			ops.push({ type: " ", line: midA[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({ type: "-", line: midA[i] });
			i++;
		} else {
			ops.push({ type: "+", line: midB[j] });
			j++;
		}
	}
	while (i < m) ops.push({ type: "-", line: midA[i++] });
	while (j < n) ops.push({ type: "+", line: midB[j++] });
	for (let k = endA; k < a.length; k++) ops.push({ type: " ", line: a[k] });

	// Assign line numbers.
	let oldNo = 1;
	let newNo = 1;
	for (const op of ops) {
		if (op.type !== "+") op.oldNo = oldNo++;
		if (op.type !== "-") op.newNo = newNo++;
	}

	// Emit hunks with context.
	const out = [`--- a/${display}`, `+++ b/${display}`];
	let idx = 0;
	while (idx < ops.length) {
		if (ops[idx].type === " ") {
			idx++;
			continue;
		}
		const hunkStart = Math.max(0, idx - DIFF_CONTEXT_LINES);
		let hunkEnd = idx;
		while (hunkEnd < ops.length) {
			if (ops[hunkEnd].type === " ") {
				// Allow small gaps of context between changes inside one hunk.
				let gap = 0;
				while (hunkEnd + gap < ops.length && ops[hunkEnd + gap].type === " ") gap++;
				if (hunkEnd + gap < ops.length && gap <= DIFF_CONTEXT_LINES * 2) {
					hunkEnd += gap;
					continue;
				}
				break;
			}
			hunkEnd++;
		}
		hunkEnd = Math.min(ops.length, hunkEnd + DIFF_CONTEXT_LINES);
		const hunk = ops.slice(hunkStart, hunkEnd);
		const oldStart = hunk.find((o) => o.oldNo !== undefined)?.oldNo ?? 1;
		const newStart = hunk.find((o) => o.newNo !== undefined)?.newNo ?? 1;
		const oldCount = hunk.filter((o) => o.type !== "+").length;
		const newCount = hunk.filter((o) => o.type !== "-").length;
		out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
		for (const op of hunk) out.push(`${op.type}${op.line}`);
		idx = hunkEnd;
	}
	return out.join("\n");
}

export const editTool = {
	name: "edit",
	description:
		"Make exact string replacements in a file. Each edit's oldText must match the file contents EXACTLY (including whitespace and indentation) and must occur exactly once in the file; include enough surrounding context to make it unique. Multiple edits are applied atomically: if any edit fails, the file is left unchanged. Preserves the file's line endings (CRLF/LF) and BOM. Returns a unified diff of the changes. Do NOT use this tool to create new files; use write instead.",
	schema: {
		path: z.string().describe("Path to the file to edit (relative to the working directory or absolute)"),
		edits: z
			.array(
				z.object({
					oldText: z.string().describe("Exact text to find. Must appear exactly once in the file."),
					newText: z.string().describe("Replacement text"),
				}),
			)
			.min(1)
			.describe("One or more replacements to apply"),
	},
	async execute({ path: filePath, edits }) {
		const absolute = resolvePath(filePath);
		const display = relativeDisplay(absolute);
		return withFileMutationQueue(absolute, async () => {
			let raw;
			try {
				raw = await readFile(absolute, "utf-8");
			} catch (err) {
				throw new Error(`Could not edit file: ${display}. ${err.message}`);
			}

			const hasBom = raw.startsWith(BOM);
			const body = hasBom ? raw.slice(1) : raw;
			const eol = detectLineEnding(body);
			const normalized = normalizeToLF(body);

			const updated = applyEdits(normalized, edits, display);

			const output = (hasBom ? BOM : "") + toLineEnding(updated, eol);
			try {
				await writeFile(absolute, output, "utf-8");
			} catch (err) {
				throw new Error(`Could not write file: ${display}. ${err.message}`);
			}

			const diff = unifiedDiff(normalized, updated, display);
			const oldLines = normalized === "" ? 0 : normalized.split("\n").length;
			const newLines = updated === "" ? 0 : updated.split("\n").length;
			const delta = newLines - oldLines;
			const summary = `Applied ${edits.length} edit(s) to ${display} (${delta >= 0 ? "+" : ""}${delta} lines)`;
			return { text: diff ? `${summary}\n\n${diff}` : summary };
		});
	},
};
