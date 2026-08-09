/**
 * Cross-platform shell execution for the bash tool.
 * Detected via priority chain, with a platform-native fallback if nothing
 * on the chain is available:
 *   win32:  git bash (via `git --exec-path` / known install dirs,
 *           deliberately skipping the WSL bash.exe shim) > pwsh >
 *           powershell > cmd.exe /d /s /c
 *   darwin: zsh > bash > sh > $SHELL
 *   linux:  bash > sh > $SHELL
 */

import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const MAX_TIMEOUT_MS = 2_147_483_647; // setTimeout upper bound (~24.8 days)

/**
 * Non-win32 shell priority chains, checked in order; first found on PATH wins.
 * darwin: zsh > bash > sh
 * linux:  bash > sh
 */
const POSIX_SHELL_CANDIDATES = {
	darwin: [
		{ command: "zsh", args: ["-c"] },
		{ command: "bash", args: ["-c"] },
		{ command: "sh", args: ["-c"] },
	],
	linux: [
		{ command: "bash", args: ["-c"] },
		{ command: "sh", args: ["-c"] },
	],
};

const WIN32_FALLBACK = { shell: process.env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c"] };
const POSIX_FALLBACK = { shell: process.env.SHELL || "/bin/sh", args: ["-c"] };
const BASH_ARGS = ["-c"];
const POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-Command"];

/**
 * Shells the caller may explicitly pick per platform (bash tool `shell`
 * parameter). Anything not listed here falls back to auto-detection.
 */
export const SUPPORTED_SHELLS = {
	win32: ["bash", "pwsh", "powershell", "cmd"],
	darwin: ["bash", "fish", "zsh"],
	linux: ["bash", "fish", "zsh"],
};

let cachedShellConfig;
const choiceCache = new Map();

/** Return true if `command` resolves to an executable on PATH. */
function isOnPath(command) {
	const finder = process.platform === "win32" ? "where" : "which";
	try {
		const result = spawnSync(finder, [command], { stdio: "ignore", windowsHide: true });
		return result.status === 0;
	} catch {
		return false;
	}
}

/**
 * Find the real MSYS/Git-for-Windows bash.exe, deliberately avoiding the
 * `bash.exe` shim that Windows' "Optional Features" installs on PATH at
 * %LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe once WSL is enabled. That
 * shim launches a full WSL distro (slow, different filesystem/path model,
 * often not even installed) instead of a lightweight native Windows shell,
 * so a plain `where bash` is unsafe on win32: WSL's shim frequently sits
 * earlier on PATH than Git's own bin directory.
 *
 * Strategy, most to least reliable:
 *   1. Ask git itself: `git --exec-path` resolves to something like
 *      "C:\Program Files\Git\mingw64\libexec\git-core" -- walk up from
 *      there to the Git install root and look for \bin\bash.exe /
 *      \usr\bin\bash.exe. This only works if git.exe itself is on PATH,
 *      but when it is, this is the most authoritative source: it's the
 *      exact Git install bash.exe belongs to, not a guess.
 *   2. Probe the well-known install directories Git for Windows uses
 *      (64-bit, 32-bit-on-64-bit, per-user), independent of PATH.
 *   3. Give up on bash entirely and fall through to pwsh/powershell/cmd --
 *      deliberately does NOT fall back to a bare `where bash`, since on a
 *      WSL-enabled machine that is exactly the shim this function exists
 *      to avoid.
 */
function findGitBashWindows() {
	const gitExecPath = spawnSync("git", ["--exec-path"], { encoding: "utf-8", windowsHide: true });
	if (gitExecPath.status === 0 && gitExecPath.stdout) {
		// e.g. C:\Program Files\Git\mingw64\libexec\git-core -> up 3 levels
		// to the Git install root, e.g. C:\Program Files\Git
		const installRoot = path.resolve(gitExecPath.stdout.trim(), "..", "..", "..");
		for (const rel of [path.join("bin", "bash.exe"), path.join("usr", "bin", "bash.exe")]) {
			const candidate = path.join(installRoot, rel);
			if (existsSync(candidate)) return candidate;
		}
	}

	const knownRoots = [
		process.env["ProgramW6432"],
		process.env["ProgramFiles"],
		process.env["ProgramFiles(x86)"],
		process.env["LocalAppData"],
	].filter(Boolean);
	for (const root of knownRoots) {
		const candidate = path.join(root, "Git", "bin", "bash.exe");
		if (existsSync(candidate)) return candidate;
	}

	return null;
}

/** Walk the platform's shell priority chain, returning the first shell found. */
function detectShellConfig() {
	if (process.platform === "win32") {
		const gitBash = findGitBashWindows();
		if (gitBash) return { shell: gitBash, args: BASH_ARGS };
		if (isOnPath("pwsh")) return { shell: "pwsh", args: ["-NoLogo", "-NoProfile", "-Command"] };
		if (isOnPath("powershell")) return { shell: "powershell", args: ["-NoLogo", "-NoProfile", "-Command"] };
		return WIN32_FALLBACK;
	}

	const candidates = POSIX_SHELL_CANDIDATES[process.platform];
	if (candidates) {
		for (const candidate of candidates) {
			if (isOnPath(candidate.command)) {
				return { shell: candidate.command, args: candidate.args };
			}
		}
	}
	return POSIX_FALLBACK;
}

export function resolveTimeoutMs(timeoutSeconds) {
	if (timeoutSeconds === undefined || timeoutSeconds === null) return undefined;
	if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
		throw new Error("Invalid timeout: must be a finite number of seconds");
	}
	const ms = timeoutSeconds * 1000;
	if (ms > MAX_TIMEOUT_MS) {
		throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_MS / 1000} seconds`);
	}
	return ms;
}

export function getShellConfig() {
	if (!cachedShellConfig) {
		cachedShellConfig = detectShellConfig();
	}
	return cachedShellConfig;
}

/**
 * Resolve an explicitly requested shell (bash tool `shell` parameter) to a
 * { shell, args } spawn config. Throws if the shell is not supported on this
 * platform or cannot be located. Results are cached per shell name.
 */
export function resolveShellChoice(name) {
	const supported = SUPPORTED_SHELLS[process.platform] ?? [];
	if (!supported.includes(name)) {
		throw new Error(
			`Shell "${name}" is not supported on ${process.platform}. Supported shells: ${supported.join(", ")}`,
		);
	}
	if (choiceCache.has(name)) return choiceCache.get(name);

	let config;
	switch (name) {
		case "bash": {
			if (process.platform === "win32") {
				const gitBash = findGitBashWindows();
				if (!gitBash) {
					throw new Error('Shell "bash" not found: no Git for Windows bash.exe could be located');
				}
				config = { shell: gitBash, args: BASH_ARGS };
			} else {
				if (!isOnPath("bash")) throw new Error('Shell "bash" not found on PATH');
				config = { shell: "bash", args: BASH_ARGS };
			}
			break;
		}
		case "pwsh":
		case "powershell": {
			if (!isOnPath(name)) throw new Error(`Shell "${name}" not found on PATH`);
			config = { shell: name, args: POWERSHELL_ARGS };
			break;
		}
		case "cmd": {
			config = WIN32_FALLBACK;
			break;
		}
		default: {
			// fish, zsh, and any future POSIX additions: plain `name -c`.
			if (!isOnPath(name)) throw new Error(`Shell "${name}" not found on PATH`);
			config = { shell: name, args: ["-c"] };
		}
	}
	choiceCache.set(name, config);
	return config;
}

/** Kill a process and its children. */
export function killProcessTree(child) {
	if (!child.pid || child.killed) return;
	if (process.platform === "win32") {
		try {
			spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		} catch {
			try {
				child.kill();
			} catch {}
		}
	} else {
		try {
			// Negative pid kills the whole process group (child spawned detached).
			process.kill(-child.pid, "SIGKILL");
		} catch {
			try {
				child.kill("SIGKILL");
			} catch {}
		}
	}
}

/**
 * Execute a shell command, streaming stdout+stderr into onData.
 * Returns { exitCode } or throws Error("timeout:<seconds>") on timeout.
 * `shellName` optionally pins the shell (see SUPPORTED_SHELLS); otherwise
 * the auto-detected platform default is used.
 */
export async function execShell(command, cwd, { onData, timeout, shellName } = {}) {
	const timeoutMs = resolveTimeoutMs(timeout);
	const { shell, args } = shellName ? resolveShellChoice(shellName) : getShellConfig();

	return new Promise((resolve, reject) => {
		const child = spawn(shell, [...args, command], {
			cwd,
			detached: process.platform !== "win32",
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		let timedOut = false;
		let timer;
		if (timeoutMs !== undefined) {
			timer = setTimeout(() => {
				timedOut = true;
				killProcessTree(child);
			}, timeoutMs);
		}

		child.stdout.on("data", onData);
		child.stderr.on("data", onData);

		child.on("error", (err) => {
			if (timer) clearTimeout(timer);
			reject(new Error(`Failed to start shell: ${err.message}`));
		});

		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			if (timedOut) {
				reject(new Error(`timeout:${timeout}`));
			} else {
				resolve({ exitCode: code });
			}
		});
	});
}
