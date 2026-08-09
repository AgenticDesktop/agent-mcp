/**
 * Cross-platform shell execution for the bash tool.
 * win32: cmd.exe /d /s /c  |  others: /bin/sh -c
 */

import { spawn } from "node:child_process";

const MAX_TIMEOUT_MS = 2_147_483_647; // setTimeout upper bound (~24.8 days)

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
	if (process.platform === "win32") {
		return { shell: process.env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c"] };
	}
	return { shell: process.env.SHELL || "/bin/sh", args: ["-c"] };
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
 */
export async function execShell(command, cwd, { onData, timeout } = {}) {
	const timeoutMs = resolveTimeoutMs(timeout);
	const { shell, args } = getShellConfig();

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
