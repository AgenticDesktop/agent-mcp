import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolvePath } from "../lib/paths.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "../lib/truncate.js";

const IMAGE_MIME = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

export const readTool = {
	name: "read",
	description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are returned as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
	schema: {
		path: z.string().describe("Absolute path to the file to read"),
		offset: z.number().optional().describe("Line number to start reading from (1-indexed)"),
		limit: z.number().optional().describe("Maximum number of lines to read"),
	},
	/** Returns { text } or { image: {data, mimeType}, text } */
	async execute({ path: filePath, offset, limit }) {
		const absolute = resolvePath(filePath);
		const display = absolute;

		const ext = path.extname(absolute).toLowerCase();
		if (IMAGE_MIME[ext]) {
			const buffer = await readFile(absolute);
			return {
				text: `Read image file [${IMAGE_MIME[ext]}]`,
				image: { data: buffer.toString("base64"), mimeType: IMAGE_MIME[ext] },
			};
		}

		let text;
		try {
			text = await readFile(absolute, "utf-8");
		} catch (err) {
			throw new Error(`Could not read file: ${display}. ${err.message}`);
		}

		// 1-indexed offset
		const startLine = Math.max(0, (offset ?? 1) - 1);
		const allLines = text.split("\n");
		if (startLine > 0 && startLine >= allLines.length) {
			throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
		}

		let lines = allLines.slice(startLine);
		let userLimitHit = false;
		if (limit !== undefined && limit >= 0 && lines.length > limit) {
			lines = lines.slice(0, limit);
			userLimitHit = true;
		}

		const truncation = truncateHead(lines.join("\n"));
		let output = truncation.content;

		const notices = [];
		const shownEnd = startLine + truncation.outputLines;
		if (truncation.firstLineExceedsLimit) {
			const size = formatSize(Buffer.byteLength(allLines[startLine] ?? "", "utf-8"));
			notices.push(
				`Line ${startLine + 1} is ${size}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLine + 1}p' ${display} | head -c ${DEFAULT_MAX_BYTES}`,
			);
		} else if (truncation.truncated) {
			const next = shownEnd + 1;
			if (truncation.truncatedBy === "lines") {
				notices.push(
					`Showing lines ${startLine + 1}-${shownEnd} of ${allLines.length}. Use offset=${next} to continue.`,
				);
			} else {
				notices.push(
					`Showing lines ${startLine + 1}-${shownEnd} of ${allLines.length} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${next} to continue.`,
				);
			}
		} else if (userLimitHit) {
			const remaining = allLines.length - shownEnd;
			notices.push(`${remaining} more lines in file. Use offset=${shownEnd + 1} to continue.`);
		}

		if (notices.length > 0) output += `\n\n[${notices.join(" ")}]`;
		return { text: output };
	},
};
