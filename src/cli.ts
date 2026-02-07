import { parseArgs } from "node:util";

export interface CLIArgs {
	goal: string | undefined;
	agent: string;
	autonomy: "low" | "medium" | "high" | "full";
	model: string | undefined;
	dryRun: boolean;
	help: boolean;
	version: boolean;
	cwd: string;
}

export function parseCliArgs(): CLIArgs {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			agent: { type: "string", short: "a", default: "claude-code" },
			autonomy: { type: "string", default: "medium" },
			model: { type: "string", short: "m" },
			"dry-run": { type: "boolean", default: false },
			help: { type: "boolean", short: "h", default: false },
			version: { type: "boolean", short: "v", default: false },
			cwd: { type: "string", default: process.cwd() },
		},
	});

	const autonomy = values.autonomy as string;
	if (!["low", "medium", "high", "full"].includes(autonomy)) {
		console.error(`Invalid autonomy level: ${autonomy}. Must be one of: low, medium, high, full`);
		process.exit(1);
	}

	return {
		goal: positionals[0],
		agent: values.agent as string,
		autonomy: autonomy as CLIArgs["autonomy"],
		model: values.model as string | undefined,
		dryRun: values["dry-run"] as boolean,
		help: values.help as boolean,
		version: values.version as boolean,
		cwd: values.cwd as string,
	};
}

export function printHelp(): void {
	console.log(`
CLIPilot - TUI meta-orchestrator for coding agents

Usage:
  clipilot [options] [goal]

Arguments:
  goal                    Development goal to accomplish (optional, interactive if omitted)

Options:
  -a, --agent <name>      Coding agent to use (default: claude-code)
                          Options: claude-code, codex, pi
  --autonomy <level>      Autonomy level (default: medium)
                          low:    confirm every step
                          medium: confirm key decisions
                          high:   fully automatic, notify on errors
                          full:   fully autonomous with auto-retry
  -m, --model <id>        LLM model for planning (default: from config)
  --dry-run               Only plan, don't execute
  --cwd <path>            Working directory (default: current)
  -h, --help              Show this help
  -v, --version           Show version

Examples:
  clipilot "Add JWT authentication to this Express app"
  clipilot --agent codex --autonomy high "Refactor the database layer"
  clipilot --dry-run "Add user registration feature"
`);
}

export function printVersion(): void {
	console.log("clipilot v0.1.0");
}
