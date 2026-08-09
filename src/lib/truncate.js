/**
 * Output truncation, mirroring pi's truncate.ts behavior:
 * - dual limits: maxLines (2000) and maxBytes (50KB), whichever hits first
 * - byte counts are UTF-8
 * - never returns a half line (except truncateTail's partial-last-line edge case)
 */

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 51200
export const GREP_MAX_LINE_LENGTH = 500;

export function formatSize(bytes) {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function splitLines(content) {
	if (content === "") return [];
	const lines = content.split("\n");
	if (content.endsWith("\n")) lines.pop();
	return lines;
}

function lineBytes(line) {
	return Buffer.byteLength(line, "utf-8");
}

/**
 * Keep the head of the content (used by read/grep/find/ls).
 * Returns { content, truncated, truncatedBy, totalLines, outputLines, outputBytes, firstLineExceedsLimit }.
 */
export function truncateHead(content, { maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES } = {}) {
	const lines = splitLines(content);
	const totalLines = lines.length;

	let outputBytes = 0;
	let kept = 0;
	let truncatedBy = null;

	for (let i = 0; i < lines.length; i++) {
		if (kept >= maxLines) {
			truncatedBy = "lines";
			break;
		}
		// +1 byte for the newline that separates this line from the previous one
		const cost = lineBytes(lines[i]) + (kept > 0 ? 1 : 0);
		if (outputBytes + cost > maxBytes) {
			if (kept === 0) {
				return {
					content: "",
					truncated: true,
					truncatedBy: "bytes",
					totalLines,
					outputLines: 0,
					outputBytes: 0,
					firstLineExceedsLimit: true,
				};
			}
			truncatedBy = "bytes";
			break;
		}
		outputBytes += cost;
		kept++;
	}

	if (truncatedBy === null && kept >= totalLines) {
		return {
			content,
			truncated: false,
			truncatedBy: null,
			totalLines,
			outputLines: totalLines,
			outputBytes,
			firstLineExceedsLimit: false,
		};
	}

	return {
		content: lines.slice(0, kept).join("\n"),
		truncated: true,
		truncatedBy,
		totalLines,
		outputLines: kept,
		outputBytes,
		firstLineExceedsLimit: false,
	};
}

/**
 * Keep the tail of the content (used by bash output).
 * Edge case: if even the last line alone exceeds maxBytes, keep the last
 * maxBytes bytes of that line (UTF-8 boundary aligned) and mark lastLinePartial.
 */
export function truncateTail(content, { maxLines = DEFAULT_MAX_LINES, maxBytes = DEFAULT_MAX_BYTES } = {}) {
	const lines = splitLines(content);
	const totalLines = lines.length;

	let outputBytes = 0;
	let kept = 0;
	let truncatedBy = null;

	for (let i = lines.length - 1; i >= 0; i--) {
		if (kept >= maxLines) {
			truncatedBy = "lines";
			break;
		}
		const cost = lineBytes(lines[i]) + (kept > 0 ? 1 : 0);
		if (outputBytes + cost > maxBytes) {
			truncatedBy = "bytes";
			break;
		}
		outputBytes += cost;
		kept++;
	}

	if (truncatedBy === null && kept >= totalLines) {
		return {
			content,
			truncated: false,
			truncatedBy: null,
			totalLines,
			outputLines: totalLines,
			outputBytes,
			lastLinePartial: false,
		};
	}

	if (kept === 0 && lines.length > 0) {
		// Partial last line: keep the tail bytes of the final line.
		const lastLine = lines[lines.length - 1];
		let buf = Buffer.from(lastLine, "utf-8");
		if (buf.length > maxBytes) {
			buf = buf.subarray(buf.length - maxBytes);
			// Align to a UTF-8 character boundary: skip continuation bytes (10xxxxxx).
			let start = 0;
			while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
			const partial = buf.subarray(start).toString("utf-8");
			return {
				content: partial,
				truncated: true,
				truncatedBy: "bytes",
				totalLines,
				outputLines: 1,
				outputBytes: Buffer.byteLength(partial, "utf-8"),
				lastLinePartial: true,
			};
		}
	}

	return {
		content: lines.slice(lines.length - kept).join("\n"),
		truncated: true,
		truncatedBy,
		totalLines,
		outputLines: kept,
		outputBytes,
		lastLinePartial: false,
	};
}

/**
 * Truncate a single line to maxChars characters (grep long-line protection).
 */
export function truncateLine(line, maxChars = GREP_MAX_LINE_LENGTH) {
	if (line.length <= maxChars) return { text: line, wasTruncated: false };
	return { text: `${line.slice(0, maxChars)}... [truncated]`, wasTruncated: true };
}
