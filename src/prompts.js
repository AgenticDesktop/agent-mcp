/**
 * Prompt injection module for agent-mcp-for-chat.
 *
 * Centralizes the system prompt text shared by all injection modes
 * (default/instruction/tool) and the error-recovery hints appended to
 * tool error returns in every mode (including none).
 */

/** Name of the prompt exposed in `prompt` mode via MCP prompts capability. */
export const PROMPT_NAME = "agent-instructions";

/** URI of the resource exposed in `resource` mode via MCP resources capability. */
export const RESOURCE_URI = "agent-mcp://instructions";

/** Description shown to MCP clients when listing available prompts. */
export const PROMPT_DESCRIPTION =
	"Operating instructions for the agent-mcp-for-chat tool server. " +
	"Retrieves the system prompt that explains path conventions, per-tool " +
	"usage rules, and common pitfalls. Inject this into the conversation " +
	"(typically as a system or user message) before invoking any tool.";

/**
 * Unified system prompt. Covers absolute-path convention, the seven tools'
 * usage rules, and common errors to avoid. Used by all injection modes.
 */
export const SYSTEM_PROMPT = `You are connected to agent-mcp-for-chat, a Model Context Protocol (MCP) tool server providing file and shell tools. Follow these rules strictly so the tools work correctly.

# Path convention (critical)

ALL path arguments MUST be absolute. Relative paths are rejected.
- Windows example: "D:\\\\projects\\\\app\\\\src\\\\index.ts"
- Linux/macOS example: "/home/user/app/src/index.ts"
- The home shortcut "~" is expanded automatically, but prefer explicit absolute paths.
- For bash, the \`cwd\` parameter must be an absolute directory path.

# Tools

## read
Read a file's contents (text or image).
- Parameters: \`path\` (absolute), optional \`offset\` (1-indexed line number), optional \`limit\` (max lines).
- Large files are truncated; the trailing notice tells you the line range shown and the next \`offset\` to use.
- Supports images (jpg, png, gif, webp, bmp) returned as attachments.

## write
Write content to a file, creating parent directories as needed. Overwrites if the file exists.
- Parameters: \`path\` (absolute), \`content\` (full file content).
- Prefer the \`edit\` tool when modifying an existing file.

## edit
Make exact string replacements in a file. Multiple edits are applied atomically.
- Parameters: \`path\` (absolute), \`edits\` (array of { oldText, newText }).
- \`oldText\` must match the file contents EXACTLY, including whitespace, indentation, and newlines.
- \`oldText\` must appear exactly once in the file; include enough surrounding context to make it unique.
- If any edit fails, the file is left unchanged.
- Do NOT use edit to create new files; use write instead.

## bash
Run a shell command in a given directory.
- Parameters: \`command\`, \`cwd\` (absolute directory), optional \`timeout\` (seconds), optional \`shell\`.
- Returns combined stdout+stderr, truncated to the tail.
- A non-zero exit code is returned as an error containing the output.
- If a command may hang, provide a \`timeout\`.

## grep
Search file contents for a regex or literal pattern.
- Parameters: \`pattern\`, \`path\` (absolute file or dir), optional \`glob\`, \`ignoreCase\`, \`literal\`, \`context\`, \`limit\`.
- Set \`literal: true\` to search for a plain string instead of a regex (avoids "Invalid regex pattern" errors).
- Skips binary files and common directories (node_modules, .git, dist, etc).

## find
Find files by glob pattern.
- Parameters: \`pattern\` (e.g. "*.ts", "**/*.json"), \`path\` (absolute dir), optional \`limit\`.

## ls
List directory entries.
- Parameters: \`path\` (absolute dir), optional \`limit\`.

# Common pitfalls

1. Using relative paths -> always use absolute paths.
2. edit oldText not matching -> read the file first and copy exact text including indentation.
3. edit oldText matching multiple locations -> include more surrounding lines in oldText.
4. bash with wrong cwd -> cwd must be an absolute directory that exists.
5. grep "Invalid regex pattern" -> set literal: true for plain-string searches.
6. read offset beyond file length -> read without offset first to learn the file size.

When a tool returns an error, a "[HINT] ..." section is appended with specific recovery guidance. Follow it before retrying.`;

/**
 * Error-to-hint mapping. Each entry is tested in order; the first match wins.
 * Based on the actual error messages thrown by tool/lib modules.
 * @type {Array<{ test: RegExp, hint: string }>}
 */
const ERROR_HINTS = [
	{
		test: /Path must be absolute/i,
		hint: 'All path arguments must be absolute. Windows example: "D:\\projects\\app\\file.ts"; Linux/macOS: "/home/user/app/file.ts". The "~" shortcut is also accepted.',
	},
	{
		test: /Directory not found/i,
		hint: "The specified directory does not exist. Use the ls tool to confirm the parent directory, or use find to search for the correct path.",
	},
	{
		test: /Not a directory/i,
		hint: "A directory path was expected but a file path was given. bash cwd, find path, and ls path must all be directories.",
	},
	{
		test: /Could not (read|write|edit) file/i,
		hint: "The file operation failed. Possible causes: the file does not exist, the parent directory is missing, or there are insufficient permissions. Use ls to verify the file exists before reading/editing.",
	},
	{
		test: /Offset.*beyond end of file/i,
		hint: "The offset exceeds the file's line count. Read the file without an offset first, note the total lines, then retry with a valid offset.",
	},
	{
		test: /oldText must not be empty/i,
		hint: "The edit tool's oldText cannot be an empty string. Provide the exact original text you want to replace.",
	},
	{
		test: /oldText not found/i,
		hint: "oldText was not found in the file. It must match exactly, including whitespace, indentation, and newlines. Read the target lines first and copy the text verbatim.",
	},
	{
		test: /oldText found.*times/i,
		hint: "oldText appears more than once, so the edit is ambiguous. Include more surrounding context lines in oldText so it matches exactly one location.",
	},
	{
		test: /overlap/i,
		hint: "Multiple edits in the same call have overlapping ranges. Merge the overlapping edits into a single edit.",
	},
	{
		test: /oldText and newText are identical/i,
		hint: "oldText and newText are the same; there is nothing to change. Remove this edit or provide a genuinely different newText.",
	},
	{
		test: /timed out/i,
		hint: "The command exceeded the timeout. Increase the timeout parameter, or optimize/simplify the command so it finishes sooner.",
	},
	{
		test: /exited with code/i,
		hint: "The command returned a non-zero exit code. Check the command syntax, the working directory (cwd must be an absolute path), and any required environment variables. The output above shows what went wrong.",
	},
	{
		test: /Invalid regex pattern/i,
		hint: 'The grep pattern is not a valid regular expression. If you meant to search for a literal string, set literal: true.',
	},
	{
		test: /Path not found/i,
		hint: "The search path does not exist. Verify the absolute path is correct, or use ls to browse the directory structure first.",
	},
	{
		test: /Cannot read directory/i,
		hint: "The directory could not be read, possibly due to insufficient permissions. Try a different directory or check permissions.",
	},
	{
		test: /Shell.*not (found|supported)/i,
		hint: "The specified shell is unavailable on this platform. Omit the shell parameter to let the server auto-detect, or use a shell supported by the current OS.",
	},
];

/**
 * Look up a recovery hint for the given error message.
 * @param {string} errorMessage - The raw error message from a tool.
 * @returns {string|null} The hint text, or null if no known pattern matches.
 */
export function getErrorHint(errorMessage) {
	for (const { test, hint } of ERROR_HINTS) {
		if (test.test(errorMessage)) return hint;
	}
	return null;
}
