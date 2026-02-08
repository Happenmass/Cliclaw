import chalk from "chalk";
import type { CheckResult, CheckStatus } from "./types.js";

const STATUS_ICONS: Record<CheckStatus, string> = {
	pass: "✓",
	fail: "✗",
	warning: "⚠",
};

const STATUS_COLORS: Record<CheckStatus, (s: string) => string> = {
	pass: chalk.green,
	fail: chalk.red,
	warning: chalk.yellow,
};

/**
 * Formats an array of health check results into a colored report string.
 *
 * Each check is rendered as `[icon] name: message`, with an optional
 * indented details line. A summary line is appended at the end.
 * Chalk automatically respects the `NO_COLOR` environment variable.
 */
export function formatReport(results: CheckResult[]): string {
	if (results.length === 0) {
		return chalk.dim("No checks performed.");
	}

	const lines: string[] = [];

	for (const result of results) {
		const colorFn = STATUS_COLORS[result.status];
		const icon = STATUS_ICONS[result.status];
		lines.push(`  ${colorFn(icon)} ${chalk.bold(result.name)}: ${result.message}`);
		if (result.details) {
			lines.push(`    ${chalk.dim(result.details)}`);
		}
	}

	const passed = results.filter((r) => r.status === "pass").length;
	const failed = results.filter((r) => r.status === "fail").length;
	const warnings = results.filter((r) => r.status === "warning").length;

	const parts: string[] = [];
	if (passed > 0) parts.push(chalk.green(`${passed} passed`));
	if (failed > 0) parts.push(chalk.red(`${failed} failed`));
	if (warnings > 0) parts.push(chalk.yellow(`${warnings} warning`));

	lines.push("");
	lines.push(`  ${parts.join(", ")}`);

	return lines.join("\n");
}
