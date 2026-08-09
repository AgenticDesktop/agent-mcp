/**
 * Path resolution helpers.
 *
 * All tool path arguments must be absolute; relative paths are rejected with
 * a guiding error. No sandbox/escape checks (same philosophy as pi: runs
 * with the launching user's permissions).
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a tool path argument to a normalized absolute path.
 * Relative paths are rejected.
 */
export function resolvePath(p) {
	if (!p || typeof p !== "string") throw new Error("path must be a non-empty string");
	let input = p.trim();
	// Expand ~ to the home directory.
	if (input === "~" || input.startsWith(`~${path.sep}`) || input.startsWith("~/")) {
		input = path.join(process.env.HOME || process.env.USERPROFILE || "", input.slice(1));
	}
	if (!path.isAbsolute(input)) {
		throw new Error(
			`Path must be absolute, got relative path: "${p}". Provide the full path (e.g. "D:\\projects\\app\\file.ts" or "/home/user/app/file.ts").`,
		);
	}
	return path.normalize(input);
}

/** Resolve a path argument and verify it is an existing directory. */
export function resolveDir(p) {
	const resolved = resolvePath(p);
	let stat;
	try {
		stat = fs.statSync(resolved);
	} catch {
		throw new Error(`Directory not found: ${resolved}`);
	}
	if (!stat.isDirectory()) {
		throw new Error(`Not a directory: ${resolved}`);
	}
	return resolved;
}

/** Directories never descended into by walk/grep/find. */
export const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	".hg",
	".svn",
	"dist",
	"build",
	"out",
	".next",
	".nuxt",
	".cache",
	".turbo",
	"coverage",
	"__pycache__",
	".venv",
	"venv",
	"target",
]);
