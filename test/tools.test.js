import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { resolvePath } from "../src/lib/paths.js";
import { getShellConfig } from "../src/lib/shell.js";
import { DEFAULT_MAX_BYTES, truncateHead, truncateLine, truncateTail } from "../src/lib/truncate.js";
import { globToRegExp, matchGlob } from "../src/lib/walk.js";
import { bashTool } from "../src/tools/bash.js";
import { editTool } from "../src/tools/edit.js";
import { findTool } from "../src/tools/find.js";
import { grepTool } from "../src/tools/grep.js";
import { lsTool } from "../src/tools/ls.js";
import { readTool } from "../src/tools/read.js";
import { writeTool } from "../src/tools/write.js";

let workDir;

before(async () => {
	workDir = await mkdtemp(path.join(tmpdir(), "agent-mcp-test-"));
});

after(async () => {
	await rm(workDir, { recursive: true, force: true });
});

const abs = (...segments) => path.join(workDir, ...segments);

// ---------- truncate ----------

test("truncateHead: content under limits passes through", () => {
	const r = truncateHead("a\nb\nc");
	assert.equal(r.truncated, false);
	assert.equal(r.content, "a\nb\nc");
	assert.equal(r.totalLines, 3);
});

test("truncateHead: line limit", () => {
	const r = truncateHead("1\n2\n3\n4\n5", { maxLines: 2 });
	assert.equal(r.truncated, true);
	assert.equal(r.truncatedBy, "lines");
	assert.equal(r.content, "1\n2");
});

test("truncateHead: byte limit never splits a line", () => {
	const r = truncateHead("aaaa\nbbbb\ncccc", { maxBytes: 6 });
	assert.equal(r.truncated, true);
	assert.equal(r.truncatedBy, "bytes");
	assert.equal(r.content, "aaaa"); // "aaaa\nbbbb" would be 9 bytes
});

test("truncateHead: first line exceeding byte limit", () => {
	const r = truncateHead("x".repeat(100) + "\nshort", { maxBytes: 10 });
	assert.equal(r.firstLineExceedsLimit, true);
	assert.equal(r.content, "");
});

test("truncateTail: keeps the end", () => {
	const r = truncateTail("1\n2\n3\n4\n5", { maxLines: 2 });
	assert.equal(r.content, "4\n5");
	assert.equal(r.truncatedBy, "lines");
});

test("truncateTail: partial last line on byte overflow", () => {
	const r = truncateTail("short\n" + "y".repeat(100), { maxBytes: 10 });
	assert.equal(r.lastLinePartial, true);
	assert.equal(r.content, "y".repeat(10));
});

test("truncateLine: caps long lines", () => {
	const { text, wasTruncated } = truncateLine("z".repeat(600));
	assert.equal(wasTruncated, true);
	assert.ok(text.endsWith("... [truncated]"));
	assert.equal(text.length, 500 + "... [truncated]".length);
});

test("truncateHead: respects 50KB default byte limit", () => {
	const big = "line\n".repeat(30000); // 150KB
	const r = truncateHead(big);
	assert.equal(r.truncated, true);
	assert.ok(r.outputBytes <= DEFAULT_MAX_BYTES);
});

// ---------- glob ----------

test("globToRegExp: *, ?, **", () => {
	assert.ok(globToRegExp("*.ts").test("foo.ts"));
	assert.ok(!globToRegExp("*.ts").test("foo.js"));
	assert.ok(globToRegExp("**/*.ts").test("a/b/c.ts"));
	assert.ok(globToRegExp("**/*.ts").test("c.ts"));
	assert.ok(globToRegExp("src/**").test("src/a/b/c"));
	assert.ok(globToRegExp("?.js").test("a.js"));
	assert.ok(!globToRegExp("?.js").test("ab.js"));
});

test("matchGlob: no-slash patterns match basename", () => {
	assert.ok(matchGlob("src/deep/file.ts", "*.ts"));
	assert.ok(!matchGlob("src/deep/file.ts", "*.js"));
});

test("matchGlob: slash patterns match anywhere in tree", () => {
	assert.ok(matchGlob("src/app/main.ts", "src/**/*.ts"));
	assert.ok(matchGlob("pkg/src/app/main.ts", "src/**/*.ts"));
});

// ---------- absolute path enforcement ----------

test("resolvePath: accepts absolute paths", () => {
	assert.equal(resolvePath(workDir), path.normalize(workDir));
});

test("resolvePath: rejects relative paths with a guiding error", () => {
	assert.throws(() => resolvePath("src/index.ts"), /Path must be absolute/);
	assert.throws(() => resolvePath("./file.txt"), /Path must be absolute/);
	assert.throws(() => resolvePath("../up.txt"), /Path must be absolute/);
});

test("tools reject relative paths", async () => {
	await assert.rejects(() => readTool.execute({ path: "relative.txt" }), /Path must be absolute/);
	await assert.rejects(() => writeTool.execute({ path: "relative.txt", content: "x" }), /Path must be absolute/);
	await assert.rejects(
		() => editTool.execute({ path: "relative.txt", edits: [{ oldText: "a", newText: "b" }] }),
		/Path must be absolute/,
	);
	await assert.rejects(() => grepTool.execute({ pattern: "x", path: "relative-dir" }), /Path must be absolute/);
	await assert.rejects(() => findTool.execute({ pattern: "*.ts", path: "relative-dir" }), /Path must be absolute/);
	await assert.rejects(() => lsTool.execute({ path: "relative-dir" }), /Path must be absolute/);
	await assert.rejects(() => bashTool.execute({ command: "echo hi", cwd: "relative-dir" }), /Path must be absolute/);
});

test("bash: rejects nonexistent cwd", async () => {
	await assert.rejects(
		() => bashTool.execute({ command: "echo hi", cwd: abs("nope-does-not-exist") }),
		/Directory not found/,
	);
});

// ---------- write / read / edit / ls ----------

test("write creates parent dirs and read returns content", async () => {
	const w = await writeTool.execute({ path: abs("sub", "dir", "hello.txt"), content: "hello\nworld\n" });
	assert.match(w.text, /Successfully wrote 12 bytes/);
	const r = await readTool.execute({ path: abs("sub", "dir", "hello.txt") });
	assert.equal(r.text, "hello\nworld\n");
});

test("read: offset/limit pagination", async () => {
	await writeTool.execute({ path: abs("paged.txt"), content: "1\n2\n3\n4\n5" });
	const r = await readTool.execute({ path: abs("paged.txt"), offset: 2, limit: 2 });
	assert.ok(r.text.startsWith("2\n3"));
	assert.match(r.text, /more lines in file\. Use offset=4 to continue/);
});

test("read: offset beyond end of file errors", async () => {
	await assert.rejects(() => readTool.execute({ path: abs("paged.txt"), offset: 99 }), /beyond end of file/);
});

test("edit: exact replacement with CRLF preserved", async () => {
	await writeFile(abs("crlf.txt"), "line1\r\nline2\r\nline3\r\n");
	const r = await editTool.execute({
		path: abs("crlf.txt"),
		edits: [{ oldText: "line2", newText: "LINE2" }],
	});
	assert.match(r.text, /Applied 1 edit/);
	assert.match(r.text, /-line2/);
	assert.match(r.text, /\+LINE2/);
	const after = await readFile(abs("crlf.txt"), "utf-8");
	assert.equal(after, "line1\r\nLINE2\r\nline3\r\n");
});

test("edit: non-unique oldText fails", async () => {
	await writeTool.execute({ path: abs("dup.txt"), content: "foo\nbar\nfoo\n" });
	await assert.rejects(
		() => editTool.execute({ path: abs("dup.txt"), edits: [{ oldText: "foo", newText: "baz" }] }),
		/found 2 times/,
	);
	// File unchanged after failed edit.
	const content = await readFile(abs("dup.txt"), "utf-8");
	assert.equal(content, "foo\nbar\nfoo\n");
});

test("edit: oldText not found fails", async () => {
	await assert.rejects(
		() => editTool.execute({ path: abs("dup.txt"), edits: [{ oldText: "missing", newText: "x" }] }),
		/oldText not found/,
	);
});

test("edit: multiple edits applied atomically", async () => {
	await writeTool.execute({ path: abs("multi.txt"), content: "a\nb\nc\n" });
	await editTool.execute({
		path: abs("multi.txt"),
		edits: [
			{ oldText: "a", newText: "A" },
			{ oldText: "c", newText: "C" },
		],
	});
	const content = await readFile(abs("multi.txt"), "utf-8");
	assert.equal(content, "A\nb\nC\n");
});

test("ls: lists entries with directory suffix, sorted", async () => {
	const r = await lsTool.execute({ path: abs("sub") });
	assert.match(r.text, /dir\//);
});

// ---------- grep / find ----------

test("grep: finds matches with line numbers", async () => {
	await writeTool.execute({ path: abs("grepme", "a.ts"), content: "const alpha = 1;\nconst beta = 2;\n" });
	const r = await grepTool.execute({ pattern: "alpha", path: abs("grepme") });
	assert.match(r.text, /a\.ts:1: const alpha = 1;/);
});

test("grep: literal + ignoreCase + glob", async () => {
	const r = await grepTool.execute({
		pattern: "BETA",
		path: abs("grepme"),
		glob: "*.ts",
		literal: true,
		ignoreCase: true,
	});
	assert.match(r.text, /a\.ts:2: const beta = 2;/);
});

test("grep: context lines use dash format", async () => {
	const r = await grepTool.execute({ pattern: "beta", path: abs("grepme"), context: 1 });
	assert.match(r.text, /a\.ts-1- const alpha = 1;/);
	assert.match(r.text, /a\.ts:2: const beta = 2;/);
});

test("grep: no matches", async () => {
	const r = await grepTool.execute({ pattern: "zzz-no-such-token", path: abs("grepme") });
	assert.equal(r.text, "No matches found");
});

test("grep: invalid regex errors", async () => {
	await assert.rejects(() => grepTool.execute({ pattern: "(unclosed", path: abs("grepme") }), /Invalid regex/);
});

test("find: glob pattern with limit", async () => {
	const r = await findTool.execute({ pattern: "*.ts", path: abs("grepme") });
	assert.match(r.text, /a\.ts/);
	const none = await findTool.execute({ pattern: "*.rs", path: abs("grepme") });
	assert.equal(none.text, "No files found matching pattern");
});

// ---------- bash ----------

test("bash: runs command in the given cwd", async () => {
	// Comparing bash's printed pwd against a Node.js-side path string is
	// unreliable: MSYS Git Bash remaps certain Windows directories to fixed
	// POSIX mountpoints (e.g. AppData\Local\Temp -> /tmp) rather than doing a
	// purely mechanical drive-letter substitution, so a generic regex cannot
	// invert its output back to a Windows path in the general case.
	//
	// Instead, prove the cwd took effect operationally: create a marker file
	// via Node at a known absolute path, then ask the shell tool to find it
	// using a relative reference from its own cwd. This only succeeds if the
	// shell actually started in workDir, regardless of that shell's own path
	// dialect (MSYS, WSL, native Windows, or POSIX).
	const markerName = "cwd-marker.txt";
	await writeFile(abs(markerName), "present");
	const { shell } = getShellConfig();
	const usesCdForCwd = process.platform === "win32" && !/bash/i.test(shell);
	const cmd = usesCdForCwd ? `type ${markerName}` : `cat ${markerName}`;
	const r = await bashTool.execute({ command: cmd, cwd: workDir, timeout: 30 });
	assert.match(r.text, /present/);
});

test("bash: echo works", async () => {
	const r = await bashTool.execute({ command: "echo hello-bash", cwd: workDir, timeout: 30 });
	assert.match(r.text, /hello-bash/);
});

test("bash: non-zero exit code reports error", async () => {
	// `exit N` is a builtin in every shell on every priority chain (cmd,
	// bash, zsh, sh, powershell/pwsh all support it with this exact syntax).
	await assert.rejects(() => bashTool.execute({ command: "exit 3", cwd: workDir }), /exited with code 3/);
});

test("bash: explicit shell selection runs the command", async () => {
	// cmd is guaranteed on win32 (COMSPEC fallback); bash on POSIX platforms.
	const shellName = process.platform === "win32" ? "cmd" : "bash";
	const r = await bashTool.execute({ command: "echo explicit-shell", cwd: workDir, timeout: 30, shell: shellName });
	assert.match(r.text, /explicit-shell/);
});

test("bash: rejects a shell unsupported on this platform", async () => {
	const shellName = process.platform === "win32" ? "fish" : "cmd";
	await assert.rejects(
		() => bashTool.execute({ command: "echo hi", cwd: workDir, shell: shellName }),
		/is not supported on/,
	);
});

test("bash: timeout kills long-running command", async () => {
	// git bash ships a real `sleep`; cmd/powershell/pwsh don't, so `ping` is
	// the shared cross-shell primitive there. sh/zsh get `sleep` directly.
	const { shell } = getShellConfig();
	const hasSleep = process.platform !== "win32" || /bash/i.test(shell);
	const cmd = hasSleep ? "sleep 10" : "ping -n 10 127.0.0.1";
	await assert.rejects(() => bashTool.execute({ command: cmd, cwd: workDir, timeout: 1 }), /timed out after 1 seconds/);
});
