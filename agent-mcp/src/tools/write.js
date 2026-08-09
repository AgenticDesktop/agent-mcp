import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withFileMutationQueue } from "../lib/mutation-queue.js";
import { relativeDisplay, resolvePath } from "../lib/paths.js";

export const writeTool = {
	name: "write",
	description:
		"Write content to a file. Creates parent directories automatically. Overwrites the file if it exists. Prefer the edit tool for modifying existing files.",
	schema: {
		path: z.string().describe("Path to the file to write (relative to the working directory or absolute)"),
		content: z.string().describe("Complete content to write to the file"),
	},
	async execute({ path: filePath, content }) {
		const absolute = resolvePath(filePath);
		const display = relativeDisplay(absolute);
		return withFileMutationQueue(absolute, async () => {
			try {
				await mkdir(path.dirname(absolute), { recursive: true });
				await writeFile(absolute, content, "utf-8");
			} catch (err) {
				throw new Error(`Could not write file: ${display}. ${err.message}`);
			}
			const bytes = Buffer.byteLength(content, "utf-8");
			const lines = content === "" ? 0 : content.split("\n").length;
			return { text: `Successfully wrote ${bytes} bytes (${lines} lines) to ${display}` };
		});
	},
};
