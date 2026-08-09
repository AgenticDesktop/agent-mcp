/**
 * Session working-directory state and path resolution.
 *
 * The client AI must set a working directory via the `cwd` tool before any
 * other tool can be used. All relative paths resolve against that directory.
 * No sandbox/escape checks (same philosophy as pi: runs with the launching
 * user's permissions).
 */

import fs from "node:fs";
import path from "node:path";

let sessionCwd = null;

export const CWD_NOT_SET_ERROR =
	'Working directory not set. Call the "cwd" tool first with the absolute path of the project directory you want to work in.';

/** Set the session working directory. Returns the normalized absolute path. */
export function setCwd(dir) {
	if (!dir || typeof dir !== "string") {
		throw new Error("cwd path must be a non-empty string");
	}
	// Expand ~ to the home directory.
	let input = dir.trim();
	if (input === "~" || input.startsWith(`~${path.sep}`) || input.startsWith("~/")) {
		input = path.join(process.env.HOME || process.env.USERPROFILE || "", input.slice(1));
	}
	const resolved = path.resolve(input);
	let stat;
	try {
		stat = fs.statSync(resolved);
	} catch {
		throw new Error(`Directory not found: ${resolved}`);
	}
	if (!stat.isDirectory()) {
		throw new Error(`Not a directory: ${resolved}`);
	}
	sessionCwd = resolved;
	return sessionCwd;
}

/** Current session working directory, or null if not set yet. */
export function getCwd() {
	return sessionCwd;
}

/** Session working directory, throwing a guiding error if not set. */
export function requireCwd() {
	if (!sessionCwd) throw new Error(CWD_NOT_SET_ERROR);
	return sessionCwd;
}

/** Resolve a (possibly relative) path against the session working directory. */
export function resolvePath(p) {
	if (!p || typeof p !== "string") throw new Error("path must be a non-empty string");
	let input = p.trim();
	if (input === "~" || input.startsWith(`~${path.sep}`) || input.startsWith("~/")) {
		input = path.join(process.env.HOME || process.env.USERPROFILE || "", input.slice(1));
	}
	if (path.isAbsolute(input)) return path.normalize(input);
	return path.resolve(requireCwd(), input);
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

/** Display helper: path relative to cwd with posix separators when possible. */
export function relativeDisplay(absolutePath, base) {
	const rel = path.relative(base ?? requireCwd(), absolutePath);
	if (rel && !rel.startsWith("..")) return rel.split(path.sep).join("/");
	return absolutePath;
}
