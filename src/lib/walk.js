/**
 * Streaming directory walker and glob matching (no external dependencies).
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { IGNORED_DIRS } from "./paths.js";

/**
 * Async generator yielding absolute file paths under rootDir.
 * Skips directories in IGNORED_DIRS. Follows no symlinks.
 */
export async function* walk(rootDir, { ignore = IGNORED_DIRS } = {}) {
	const stack = [rootDir];
	while (stack.length > 0) {
		const dir = stack.pop();
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue; // unreadable directory: skip
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!ignore.has(entry.name)) stack.push(full);
			} else if (entry.isFile()) {
				yield full;
			}
		}
	}
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports: ** (any path segments), * (within a segment), ? (single char).
 * Matching is done against posix-style relative paths.
 */
export function globToRegExp(glob) {
	let re = "";
	let i = 0;
	const n = glob.length;
	while (i < n) {
		const c = glob[i];
		if (c === "*") {
			if (glob[i + 1] === "*") {
				// '**' optionally followed by '/'
				if (glob[i + 2] === "/") {
					re += "(?:[^/]+/)*";
					i += 3;
				} else {
					re += ".*";
					i += 2;
				}
			} else {
				re += "[^/]*";
				i += 1;
			}
		} else if (c === "?") {
			re += "[^/]";
			i += 1;
		} else if ("\\^$.|+()[]{}".includes(c)) {
			re += `\\${c}`;
			i += 1;
		} else {
			re += c;
			i += 1;
		}
	}
	return new RegExp(`^${re}$`);
}

/**
 * Test whether a relative path (posix separators) matches a glob pattern.
 * Patterns without a slash match against the basename only (like fd --glob).
 */
export function matchGlob(relPosixPath, pattern) {
	const normalized = pattern.split("\\").join("/");
	if (!normalized.includes("/")) {
		const base = relPosixPath.split("/").pop();
		return globToRegExp(normalized).test(base);
	}
	// Path-containing patterns match anywhere in the tree (like pi's fd usage,
	// which prefixes '**/' to such patterns).
	const effective =
		normalized.startsWith("**/") || normalized.startsWith("/") ? normalized : `**/${normalized}`;
	return globToRegExp(effective).test(relPosixPath);
}
