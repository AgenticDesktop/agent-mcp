import { z } from "zod";
import { getCwd, setCwd } from "../lib/paths.js";

export const cwdTool = {
	name: "cwd",
	description:
		"Set or query the working directory for this session. You MUST call this tool with an absolute path before using any other tool (read/write/edit/bash/grep/find/ls). All relative paths used by other tools resolve against the directory set here. Call without arguments to query the current setting.",
	schema: {
		path: z
			.string()
			.optional()
			.describe(
				"Absolute path of the working directory to set (e.g. 'D:\\\\projects\\\\my-app' or '/home/user/my-app'). Omit to query the current working directory.",
			),
	},
	async execute({ path }) {
		if (path) {
			const resolved = setCwd(path);
			return { text: `Working directory set to: ${resolved}` };
		}
		const current = getCwd();
		if (!current) {
			return { text: "Working directory is not set yet. Call the cwd tool with an absolute path to set it." };
		}
		return { text: `Current working directory: ${current}` };
	},
};
