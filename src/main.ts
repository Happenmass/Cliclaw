#!/usr/bin/env node

import { parseCliArgs, printHelp, printVersion } from "./cli.js";

async function main(): Promise<void> {
	const args = parseCliArgs();

	if (args.help) {
		printHelp();
		process.exit(0);
	}

	if (args.version) {
		printVersion();
		process.exit(0);
	}

	// TODO: Step 2-14 的组件将在这里初始化和连接
	console.log("CLIPilot v0.1.0");
	console.log(`Agent: ${args.agent}`);
	console.log(`Autonomy: ${args.autonomy}`);
	console.log(`Working dir: ${args.cwd}`);

	if (args.goal) {
		console.log(`Goal: ${args.goal}`);
	} else {
		console.log("No goal specified. Interactive mode not yet implemented.");
	}

	if (args.dryRun) {
		console.log("(dry-run mode)");
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
