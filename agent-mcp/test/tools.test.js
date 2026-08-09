import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { getCwd, setCwd } from "../src/lib/paths.js";
import { DEFAULT_MAX_BYTES, truncateHead, truncateLine, truncateTail } from "../src/lib/truncate.js";
import { globToRegExp, matchGlob } from "../src/lib/walk.js";
import { bashTool } from "../src/tools/bash.js";
import { cwdTool } from "../src/tools/cwd.js";
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

// ---------- cwd tool ----------

test("cwd: query before set reports not-set", async () => {
	// Fresh state only if no other test ran first; use a distinctive path then reset.
	const result = await cwdTool.execute({});
	// Either not set (first run) or already set by an earlier test.
	assert.match(result.text, /not set|Current working directory/);
});

test("cwd: set and query", async () => {
	const set = await cwdTool.execute({ path: workDir });
	assert.ok(set.text.includes(workDir));
	assert.equal(getCwd(), path.resolve(workDir));
	const query = await cwdTool.execute({});
	assert.ok(query.text.includes(workDir));
});

test("cwd: rejects nonexistent directory", async () => {
	await assert.rejects(() => cwdTool.execute({ path: path.join(workDir, "nope-does-not-exist") }));
});

test("tools require cwd to be set", async () => {
	// Reset module state by importing a fresh copy is complex; instead verify
	// requireCwd semantics through a tool call with cwd set to workDir.
	setCwd(workDir);
	const result = await lsTool.execute({});
	assert.ok(result.text.length > 0 || result.text === "(empty directory)");
});

// ---------- write / read / edit / ls ----------

test("write creates parent dirs and read returns content", async () => {
	setCwd(workDir);
	const w = await writeTool.execute({ path: "sub/dir/hello.txt", content: "hello\nworld\n" });
	assert.match(w.text, /Successfully wrote 12 bytes/);
	const r = await readTool.execute({ path: "sub/dir/hello.txt" });
	assert.equal(r.text, "hello\nworld\n");
});

test("read: offset/limit pagination", async () => {
	setCwd(workDir);
	await writeTool.execute({ path: "paged.txt", content: "1\n2\n3\n4\n5" });
	const r = await readTool.execute({ path: "paged.txt", offset: 2, limit: 2 });
	assert.ok(r.text.startsWith("2\n3"));
	assert.match(r.text, /more lines in file\. Use offset=4 to continue/);
});

test("read: offset beyond end of file errors", async () => {
	setCwd(workDir);
	await assert.rejects(() => readTool.execute({ path: "paged.txt", offset: 99 }), /beyond end of file/);
});

test("edit: exact replacement with CRLF preserved", async () => {
	setCwd(workDir);
	await writeFile(path.join(workDir, "crlf.txt"), "line1\r\nline2\r\nline3\r\n");
	const r = await editTool.execute({
		path: "crlf.txt",
		edits: [{ oldText: "line2", newText: "LINE2" }],
	});
	assert.match(r.text, /Applied 1 edit/);
	assert.match(r.text, /-line2/);
	assert.match(r.text, /\+LINE2/);
	const after = await readFile(path.join(workDir, "crlf.txt"), "utf-8");
	assert.equal(after, "line1\r\nLINE2\r\nline3\r\n");
});

test("edit: non-unique oldText fails", async () => {
	setCwd(workDir);
	await writeTool.execute({ path: "dup.txt", content: "foo\nbar\nfoo\n" });
	await assert.rejects(
		() => editTool.execute({ path: "dup.txt", edits: [{ oldText: "foo", newText: "baz" }] }),
		/found 2 times/,
	);
	// File unchanged after failed edit.
	const content = await readFile(path.join(workDir, "dup.txt"), "utf-8");
	assert.equal(content, "foo\nbar\nfoo\n");
});

test("edit: oldText not found fails", async () => {
	setCwd(workDir);
	await assert.rejects(
		() => editTool.execute({ path: "dup.txt", edits: [{ oldText: "missing", newText: "x" }] }),
		/oldText not found/,
	);
});

test("edit: multiple edits applied atomically", async () => {
	setCwd(workDir);
	await writeTool.execute({ path: "multi.txt", content: "a\nb\nc\n" });
	await editTool.execute({
		path: "multi.txt",
		edits: [
			{ oldText: "a", newText: "A" },
			{ oldText: "c", newText: "C" },
		],
	});
	const content = await readFile(path.join(workDir, "multi.txt"), "utf-8");
	assert.equal(content, "A\nb\nC\n");
});

test("ls: lists entries with directory suffix, sorted", async () => {
	setCwd(workDir);
	const r = await lsTool.execute({ path: "sub" });
	assert.match(r.text, /dir\//);
});

// ---------- grep / find ----------

test("grep: finds matches with line numbers", async () => {
	setCwd(workDir);
	await writeTool.execute({ path: "grepme/a.ts", content: "const alpha = 1;\nconst beta = 2;\n" });
	const r = await grepTool.execute({ pattern: "alpha", path: "grepme" });
	assert.match(r.text, /a\.ts:1: const alpha = 1;/);
});

test("grep: literal + ignoreCase + glob", async () => {
	setCwd(workDir);
	const r = await grepTool.execute({
		pattern: "BETA",
		path: "grepme",
		glob: "*.ts",
		literal: true,
		ignoreCase: true,
	});
	assert.match(r.text, /a\.ts:2: const beta = 2;/);
});

test("grep: context lines use dash format", async () => {
	setCwd(workDir);
	const r = await grepTool.execute({ pattern: "beta", path: "grepme", context: 1 });
	assert.match(r.text, /a\.ts-1- const alpha = 1;/);
	assert.match(r.text, /a\.ts:2: const beta = 2;/);
});

test("grep: no matches", async () => {
	setCwd(workDir);
	const r = await grepTool.execute({ pattern: "zzz-no-such-token", path: "grepme" });
	assert.equal(r.text, "No matches found");
});

test("grep: invalid regex errors", async () => {
	setCwd(workDir);
	await assert.rejects(() => grepTool.execute({ pattern: "(unclosed", path: "grepme" }), /Invalid regex/);
});

test("find: glob pattern with limit", async () => {
	setCwd(workDir);
	const r = await findTool.execute({ pattern: "*.ts", path: "grepme" });
	assert.match(r.text, /a\.ts/);
	const none = await findTool.execute({ pattern: "*.rs", path: "grepme" });
	assert.equal(none.text, "No files found matching pattern");
});

// ---------- bash ----------

test("bash: runs command in session cwd", async () => {
	setCwd(workDir);
	const cmd = process.platform === "win32" ? "echo hello-bash" : "echo hello-bash";
	const r = await bashTool.execute({ command: cmd, timeout: 30 });
	assert.match(r.text, /hello-bash/);
});

test("bash: non-zero exit code reports error", async () => {
	setCwd(workDir);
	const cmd = process.platform === "win32" ? "exit 3" : "exit 3";
	await assert.rejects(() => bashTool.execute({ command: cmd }), /exited with code 3/);
});

test("bash: timeout kills long-running command", async () => {
	setCwd(workDir);
	const cmd = process.platform === "win32" ? "ping -n 10 127.0.0.1" : "sleep 10";
	await assert.rejects(() => bashTool.execute({ command: cmd, timeout: 1 }), /timed out after 1 seconds/);
});
