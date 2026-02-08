// ─── Health Check Types ──────────────────────────────────

/** Status outcome of an individual health check. */
export type CheckStatus = "pass" | "fail" | "warning";

/** Result produced by a single health check. */
export interface CheckResult {
	/** Identifier for the check (e.g. "tmux-installed", "config-valid"). */
	name: string;
	/** Whether the check passed, failed, or produced a warning. */
	status: CheckStatus;
	/** Human-readable description of the outcome. */
	message: string;
	/** Optional remediation steps or additional context. */
	details?: string;
}

// ─── Report ──────────────────────────────────────────────

/** Aggregated report from all health checks. */
export interface DoctorReport {
	/** Individual results from every check that was run. */
	checks: CheckResult[];
	/** Overall status: unhealthy if any check has status "fail". */
	overallStatus: "healthy" | "unhealthy";
}

// ─── Check Implementation ────────────────────────────────

/** A health check function. Returns its result synchronously or as a promise. */
export type HealthCheckFunction = () => CheckResult | Promise<CheckResult>;
